import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Boots the demo blog headless on a fresh SQLite database and calls the plugin's content tools as
 * admins with different roles, the way a conversation does: the plugin as Strapi loads it (dist),
 * Strapi's own permission engine, real queries. No model is involved.
 *
 * KLYMBAK_TEST_APP points it at another copy of the demo, e.g. one installed from the packed
 * tarballs, to test the package as npm would ship it.
 */

const appDir = process.env.KLYMBAK_TEST_APP ? path.resolve(process.env.KLYMBAK_TEST_APP) : fileURLToPath(new URL("../../../apps/strapi-demo/", import.meta.url));
const databaseFile = `.tmp/integration-${process.pid}.db`;
const ARTICLE = "api::article.article";

const seed = JSON.parse(readFileSync(path.join(appDir, "data/seed.json"), "utf8")) as {
  articles: { title: string; slug: string; status: "draft" | "published" | "modified" }[];
};

type Admin = { id: number; firstname: string; roles: { code: string }[] };
type Result = { text: string; isError: boolean };

let strapi: any;

beforeAll(async () => {
  Object.assign(process.env, {
    DATABASE_CLIENT: "sqlite",
    DATABASE_FILENAME: databaseFile,
    APP_KEYS: "integration-key-1,integration-key-2",
    API_TOKEN_SALT: "integration",
    ADMIN_JWT_SECRET: "integration",
    TRANSFER_TOKEN_SALT: "integration",
    JWT_SECRET: "integration",
    ENCRYPTION_KEY: "integration-encryption-key",
    // No models, no MCP: only the in-process tools.
    LOCAL_MODELS: "false",
    KLYMBAK_MCP_TOKEN: "",
    MCP_ENABLED: "false",
    STRAPI_TELEMETRY_DISABLED: "true",
    STRAPI_DISABLE_UPDATE_NOTIFICATION: "true",
  });
  // The demo's own copy of Strapi, so the app, its plugins and this test share one instance.
  const { createStrapi } = createRequire(path.join(appDir, "package.json"))("@strapi/strapi");
  const app = createStrapi({ appDir, distDir: path.join(appDir, "dist") });
  app.log.level = "warn";
  strapi = await app.load();
});

afterAll(async () => {
  // destroy() calls process.removeAllListeners(), which would cut this forked worker off from
  // vitest, so they are put back. (Worker threads avoid that, but crash on exit after Strapi.)
  const events = process.eventNames() as NodeJS.Signals[];
  const listeners = events.map((event) => [event, process.listeners(event)] as const);
  await strapi?.destroy();
  for (const [event, fns] of listeners) {
    for (const fn of fns) if (!process.listeners(event).includes(fn)) process.on(event, fn);
  }
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(path.join(appDir, databaseFile + suffix), { force: true });
});

async function createAdmin(firstname: string, roleCode: string, options: { isActive?: boolean } = {}): Promise<Admin> {
  const role = await strapi.db.query("admin::role").findOne({ where: { code: roleCode } });
  const { id } = await strapi.service("admin::user").create({
    firstname,
    lastname: "Tester",
    email: `${firstname.toLowerCase()}@example.com`,
    isActive: options.isActive ?? true,
    roles: [role.id],
  });
  return strapi.db.query("admin::user").findOne({ where: { id }, populate: ["roles"] });
}

/** Calls tools as this admin, with the context a chat run gives them. */
function actingAs(admin: Admin) {
  const user = { id: String(admin.id), name: admin.firstname, roles: admin.roles.map((role) => role.code) };
  const ctx = {
    user,
    sessionId: "integration",
    agent: "main",
    headless: false,
    source: "chat",
    runtime: strapi.plugin("klymbak").service("agent").runtime,
    toolCallId: "call-1",
    signal: new AbortController().signal,
    progress() {},
  };
  const tool = (name: string) => {
    const found = ctx.runtime.allTools().find((candidate: { name: string }) => candidate.name === name);
    if (!found) throw new Error(`No tool ${name}`);
    return found;
  };
  return {
    async call(name: string, args: Record<string, unknown>): Promise<Result> {
      const output = await tool(name).execute(args, ctx);
      return typeof output === "string" ? { text: output, isError: false } : { text: output.text ?? JSON.stringify(output.data), isError: output.isError === true };
    },
    approval: (name: string, args: Record<string, unknown>) => tool(name).approval(args, ctx),
    /** find_entries' parsed result. */
    async find(args: Record<string, unknown>) {
      const result = await this.call("find_entries", { contentType: ARTICLE, pageSize: 100, ...args });
      expect(result.isError, result.text).toBe(false);
      return JSON.parse(result.text) as { total: number; results: Record<string, any>[] };
    },
    /** Creates an article and returns its documentId. */
    async createArticle(data: Record<string, unknown>) {
      const result = await this.call("create_entry", { contentType: ARTICLE, data });
      expect(result.isError, result.text).toBe(false);
      return lastLineJson(result.text).documentId as string;
    },
  };
}

/** Write tools end with the entry as JSON on the last line. */
const lastLineJson = (text: string) => JSON.parse(text.slice(text.lastIndexOf("\n") + 1));

async function seededArticle(slug: string): Promise<{ documentId: string; title: string }> {
  return strapi.documents(ARTICLE).findFirst({ filters: { slug }, status: "draft", fields: ["title"] });
}

describe("as a super admin", () => {
  let admin: ReturnType<typeof actingAs>;
  beforeAll(async () => {
    admin = actingAs(await createAdmin("Ada", "strapi-super-admin"));
  });

  it("lists the Content Manager's types with every action", async () => {
    const result = await admin.call("list_content_types", {});
    const rows = JSON.parse(result.text) as { uid: string; youCan: string[] }[];
    expect(rows.map((row) => row.uid).sort()).toEqual([
      "api::about.about",
      "api::article.article",
      "api::author.author",
      "api::category.category",
      "api::global.global",
      "plugin::users-permissions.user",
    ]);
    expect(rows.find((row) => row.uid === ARTICLE)?.youCan).toEqual(["read", "create", "update", "delete", "publish"]);
  });

  it("finds the seeded articles with their Draft & Publish status", async () => {
    const { total, results } = await admin.find({});
    expect(total).toBe(seed.articles.length);
    const statuses = Object.fromEntries(results.map((entry) => [entry.slug, entry.status]));
    expect(statuses).toEqual(Object.fromEntries(seed.articles.map((article) => [article.slug, article.status])));
  });

  it("filters with Strapi's syntax, through relations too", async () => {
    const { results } = await admin.find({ filters: { category: { name: { $eq: "food" } } } });
    expect(results.map((entry) => entry.slug)).toEqual(["sourdough-for-people-who-hate-waiting"]);
  });

  it("reads one entry in full: relations by label, dynamic zones, no database ids", async () => {
    const { documentId } = await seededArticle("this-shrimp-is-awesome");
    const result = await admin.call("get_entry", { contentType: ARTICLE, documentId });
    const { entry } = JSON.parse(result.text);
    expect(entry.title).toBe("This shrimp is awesome");
    expect(entry.author).toMatchObject({ name: expect.any(String) });
    expect(entry.category).toMatchObject({ name: "nature" });
    expect(entry.blocks.some((block: { __component: string; body?: unknown }) => block.__component === "shared.rich-text" && typeof block.body === "string")).toBe(true);
    expect(JSON.stringify(entry)).not.toMatch(/"id":/);
  });

  it("names the entry on approval cards", async () => {
    const { documentId, title } = await seededArticle("this-shrimp-is-awesome");
    const approval = await admin.approval("update_entry", { contentType: ARTICLE, documentId, data: { description: "New" } });
    expect(approval).toMatchObject({ title: `Update Article "${title}"`, description: "Fields: description", risk: "medium" });
  });

  it("creates, publishes, edits, discards and deletes, as the Content Manager would", async () => {
    const documentId = await admin.createArticle({ title: "Integration notes", slug: "integration-notes", description: "Before." });
    const status = async () => (await admin.find({ filters: { documentId } })).results[0]?.status;
    expect(await status()).toBe("draft");

    expect((await admin.call("publish_entry", { contentType: ARTICLE, documentId })).isError).toBe(false);
    expect(await status()).toBe("published");

    expect((await admin.call("update_entry", { contentType: ARTICLE, documentId, data: { description: "After." } })).isError).toBe(false);
    expect(await status()).toBe("modified");

    expect((await admin.call("discard_draft", { contentType: ARTICLE, documentId })).isError).toBe(false);
    expect(await status()).toBe("published");
    expect((await admin.find({ filters: { documentId } })).results[0]?.description).toBe("Before.");

    expect((await admin.call("unpublish_entry", { contentType: ARTICLE, documentId })).isError).toBe(false);
    expect(await status()).toBe("draft");

    expect((await admin.call("delete_entry", { contentType: ARTICLE, documentId })).isError).toBe(false);
    expect((await admin.find({ filters: { documentId } })).total).toBe(0);
  });

  it("returns Strapi's validation errors as a result the model can act on", async () => {
    const { documentId } = await seededArticle("this-shrimp-is-awesome");
    const result = await admin.call("update_entry", { contentType: ARTICLE, documentId, data: { description: "x".repeat(81) } });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("description");
  });

  it("reads a single type without a documentId and won't create a second entry", async () => {
    const read = await admin.call("get_entry", { contentType: "api::global.global" });
    expect(JSON.parse(read.text).entry.siteName).toEqual(expect.any(String));
    const create = await admin.call("create_entry", { contentType: "api::global.global", data: { siteName: "Again", siteDescription: "Again" } });
    expect(create).toMatchObject({ isError: true, text: expect.stringContaining("already has its entry") });
  });
});

describe("as an Author: only entries they created, and no publishing", () => {
  let author: ReturnType<typeof actingAs>;
  let superAdmin: ReturnType<typeof actingAs>;
  beforeAll(async () => {
    author = actingAs(await createAdmin("Arthur", "strapi-author"));
    superAdmin = actingAs(await createAdmin("Root", "strapi-super-admin"));
  });

  it("sees what the role allows on each type", async () => {
    const rows = JSON.parse((await author.call("list_content_types", {})).text) as { uid: string; youCan: string[] }[];
    expect(rows.find((row) => row.uid === ARTICLE)?.youCan).toEqual(["read", "create", "update", "delete"]);
  });

  it("finds none of the entries others created", async () => {
    expect((await author.find({})).total).toBe(0);
  });

  it("can't read, change or delete someone else's entry, and the approval card doesn't name it", async () => {
    const { documentId, title } = await seededArticle("this-shrimp-is-awesome");
    expect(await author.call("get_entry", { contentType: ARTICLE, documentId })).toMatchObject({ isError: true, text: expect.stringContaining("read this Article") });
    expect(await author.call("update_entry", { contentType: ARTICLE, documentId, data: { description: "Mine now" } })).toMatchObject({
      isError: true,
      text: expect.stringContaining("update this Article"),
    });
    expect(await author.call("delete_entry", { contentType: ARTICLE, documentId })).toMatchObject({ isError: true, text: expect.stringContaining("delete this Article") });

    const approval = await author.approval("update_entry", { contentType: ARTICLE, documentId, data: { description: "Mine now" } });
    expect(approval.title).toBe(`Update Article (${documentId})`);
    expect(approval.title).not.toContain(title);
    expect((await seededArticle("this-shrimp-is-awesome")).title).toBe(title);
  });

  it("works on their own entries, except publishing them", async () => {
    const documentId = await author.createArticle({ title: "Arthur's draft", slug: "arthurs-draft" });
    expect((await author.find({})).results.map((entry) => entry.documentId)).toEqual([documentId]);
    expect((await author.call("get_entry", { contentType: ARTICLE, documentId })).isError).toBe(false);
    expect((await author.call("update_entry", { contentType: ARTICLE, documentId, data: { description: "Getting there." } })).isError).toBe(false);
    expect(await author.call("publish_entry", { contentType: ARTICLE, documentId })).toMatchObject({ isError: true, text: expect.stringContaining("publish Article entries") });

    // Recorded as theirs, as in the Content Manager: a super admin sees it with its creator.
    const created = await strapi.documents(ARTICLE).findOne({ documentId, status: "draft", populate: { createdBy: { fields: ["firstname"] } } });
    expect(created.createdBy.firstname).toBe("Arthur");
    expect((await superAdmin.find({ filters: { documentId } })).total).toBe(1);

    expect((await author.call("delete_entry", { contentType: ARTICLE, documentId })).isError).toBe(false);
    expect((await author.find({})).total).toBe(0);
  });
});

describe("with field-level permissions", () => {
  let proofreader: ReturnType<typeof actingAs>;
  let roleId: number;
  const grant = (update: boolean) =>
    strapi.service("admin::role").assignPermissions(roleId, [
      { action: "plugin::content-manager.explorer.read", subject: ARTICLE, properties: { fields: ["title", "slug", "description"] }, conditions: [] },
      ...(update ? [{ action: "plugin::content-manager.explorer.update", subject: ARTICLE, properties: { fields: ["description"] }, conditions: [] }] : []),
    ]);

  beforeAll(async () => {
    ({ id: roleId } = await strapi.service("admin::role").create({ name: "Proofreader", code: "proofreader", description: "Fixes descriptions." }));
    await grant(true);
    proofreader = actingAs(await createAdmin("Petra", "proofreader"));
  });

  it("lists only the types the role can read", async () => {
    const rows = JSON.parse((await proofreader.call("list_content_types", {})).text) as { uid: string; youCan: string[] }[];
    expect(rows).toMatchObject([{ uid: ARTICLE, youCan: ["read", "update"] }]);
  });

  it("reads only the fields the role can read", async () => {
    const { documentId } = await seededArticle("this-shrimp-is-awesome");
    const { entry } = JSON.parse((await proofreader.call("get_entry", { contentType: ARTICLE, documentId })).text);
    expect(entry).toMatchObject({ documentId, title: "This shrimp is awesome", slug: "this-shrimp-is-awesome" });
    expect(entry).not.toHaveProperty("blocks");
    expect(entry).not.toHaveProperty("author");
    expect(entry).not.toHaveProperty("category");
  });

  it("changes only the fields the role can update, and says which it left alone", async () => {
    const { documentId, title } = await seededArticle("this-shrimp-is-awesome");
    const result = await proofreader.call("update_entry", { contentType: ARTICLE, documentId, data: { title: "Renamed", description: "Proofread." } });
    expect(result.isError, result.text).toBe(false);
    expect(result.text).toContain("Not changed, because your role can't edit them: title");
    const after = await strapi.documents(ARTICLE).findOne({ documentId, status: "draft" });
    expect(after).toMatchObject({ title, description: "Proofread." });
  });

  it("can't create entries", async () => {
    expect(await proofreader.call("create_entry", { contentType: ARTICLE, data: { title: "New" } })).toMatchObject({ isError: true, text: expect.stringContaining("create Article entries") });
  });

  it("applies a role change on the next call", async () => {
    await grant(false);
    const { documentId } = await seededArticle("this-shrimp-is-awesome");
    expect(await proofreader.call("update_entry", { contentType: ARTICLE, documentId, data: { description: "Again." } })).toMatchObject({
      isError: true,
      text: expect.stringContaining("edit Article entries"),
    });
  });
});

describe("skills", () => {
  it("loads the project's skill folder, with the documents a skill refers to", async () => {
    const editor = actingAs(await createAdmin("Sid", "strapi-editor"));
    const checklist = await editor.call("use_skill", { name: "pre-publish-checklist" });
    expect(checklist.text).toContain("# Skill: pre-publish-checklist");
    expect(checklist.text).toContain("call publish_entry");
    const writing = await editor.call("use_skill", { name: "write-article" });
    expect(writing.text).toContain("reference/tone.md");
    expect((await editor.call("use_skill", { name: "write-article", file: "reference/tone.md" })).text).toContain("No exclamation marks");
  });
});

describe("access", () => {
  it("refuses to act for a deactivated admin", async () => {
    const inactive = actingAs(await createAdmin("Ivy", "strapi-super-admin", { isActive: false }));
    expect(await inactive.call("list_content_types", {})).toMatchObject({ isError: true, text: expect.stringContaining("none that is active") });
  });
});
