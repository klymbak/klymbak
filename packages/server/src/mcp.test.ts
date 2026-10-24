import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpTransport } from "@earendil-works/pi-mcp";
import type { McpResourceInfo } from "@klymbak/protocol";
import { AgentError } from "./errors.ts";
import { McpManager, mcpToolFlags, resourceContent, resourceTools, structuredUi } from "./mcp.ts";
import { fakeMcpServer } from "./testing/mcp-server.ts";
import type { McpServerConfig, ToolContext } from "./types.ts";

const quiet = { info() {}, warn() {}, error() {} };

/** Connects to in-memory servers by name instead of starting processes. */
class TestMcpManager extends McpManager {
  readonly transports = new Map<string, McpTransport>();

  constructor() {
    super(quiet, () => undefined);
  }

  protected override transport(name: string): McpTransport {
    return this.transports.get(name)!;
  }
}

/**
 * A carrier's server: two resources, a shipment template, a prompt with one required argument, suggestions for both,
 * a tool that links to a label, and failures on request.
 */
function carrier() {
  let resources = [
    { uri: "carrier://policies/returns", name: "returns", title: "Return policy", mimeType: "text/markdown" },
    { uri: "carrier://labels/sample", name: "sample-label", mimeType: "image/png" },
  ];
  const tracking = ["AC123", "AC124", "BX900"];
  const server = fakeMcpServer(
    { tools: {}, resources: { listChanged: true }, prompts: { listChanged: true }, completions: {} },
    {
      "tools/list": () => ({ tools: [{ name: "find_label", inputSchema: { type: "object" } }] }),
      "tools/call": () => ({ content: [{ type: "resource_link", uri: "carrier://labels/RTN-1", name: "Return label RTN-1" }] }),
      "resources/list": () => ({ resources }),
      "resources/templates/list": () => ({
        resourceTemplates: [{ uriTemplate: "carrier://shipments/{trackingNumber}{?events}", name: "shipment", title: "Shipment", mimeType: "application/json" }],
      }),
      "resources/read": ({ uri }: { uri: string }) => {
        if (uri === "carrier://labels/sample") throw new Error("Label printer offline");
        if (uri.startsWith("carrier://shipments/")) return { contents: [{ uri, mimeType: "application/json", text: `{"shipment":"${uri}"}` }] };
        if (uri.startsWith("carrier://labels/")) return { contents: [{ uri, mimeType: "text/plain", text: `Label ${uri}` }] };
        return { contents: [{ uri, mimeType: "text/markdown", text: "Returns are free within 30 days." }] };
      },
      "completion/complete": ({ argument }: { argument: { name: string; value: string } }) => ({
        completion: { values: tracking.filter((value) => value.startsWith(argument.value)) },
      }),
      "prompts/list": ({ cursor }: { cursor?: string } = {}) =>
        cursor
          ? { prompts: [{ name: "weekly_report" }] }
          : {
              prompts: [
                {
                  name: "delay_notice",
                  title: "Delay notice",
                  description: "Draft an email about a late parcel",
                  arguments: [
                    { name: "trackingNumber", required: true },
                    { name: "tone", description: "friendly or formal" },
                  ],
                },
              ],
              nextCursor: "2",
            },
      "prompts/get": ({ name, arguments: args }: { name: string; arguments: Record<string, string> }) => ({
        messages: [
          { role: "user", content: { type: "text", text: `Draft a ${args.tone ?? "friendly"} delay notice for ${args.trackingNumber} (${name}).` } },
          { role: "user", content: { type: "resource", resource: { uri: "carrier://policies/returns", text: "Returns are free." } } },
        ],
      }),
    },
  );
  return { ...server, setResources: (next: typeof resources) => (resources = next) };
}

async function connect(config: Partial<McpServerConfig> = {}) {
  const server = carrier();
  const manager = new TestMcpManager();
  manager.transports.set("carrier", server.transport);
  managers.push(manager);
  const info = await manager.connect("carrier", { command: "unused", ...config } as McpServerConfig, false);
  expect(info.status).toBe("connected");
  return { manager, server };
}

const managers: McpManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
});

describe("MCP resources and prompts", () => {
  it("lists them for the people the server is for", async () => {
    const { manager } = await connect({ roles: ["support"] });

    expect(manager.resources(["admin"])).toEqual([]);
    expect(manager.resources(["support"])).toEqual([
      { server: "carrier", uri: "carrier://policies/returns", name: "Return policy", mimeType: "text/markdown", description: undefined },
      { server: "carrier", uri: "carrier://labels/sample", name: "sample-label", mimeType: "image/png", description: undefined },
    ]);
    // Both pages of prompts.
    expect(manager.prompts(["support"]).map((p) => p.name)).toEqual(["delay_notice", "weekly_report"]);
    expect(manager.prompts(["support"])[0]).toMatchObject({ title: "Delay notice", arguments: [{ name: "trackingNumber", required: true }, { name: "tone" }] });
  });

  it("leaves out what the config turns off", async () => {
    const { manager, server } = await connect({ resources: false, prompts: false });
    expect(manager.resources([])).toEqual([]);
    expect(manager.prompts([])).toEqual([]);
    expect(server.calls.map((c) => c.method)).not.toContain("resources/list");
  });

  it("lists them again when the server says they changed", async () => {
    const { manager, server } = await connect();
    server.setResources([{ uri: "carrier://zones", name: "zones", mimeType: "text/csv" }]);
    await server.notify("notifications/resources/list_changed");
    await vi.waitFor(() => expect(manager.resources([]).map((r) => r.uri)).toEqual(["carrier://zones"]));
  });

  it("reads a listed resource, and only a listed one", async () => {
    const { manager } = await connect({ roles: ["support"] });

    const { resource, contents } = await manager.readResource({ server: "carrier", uri: "carrier://policies/returns" }, ["support"]);
    expect(resource.name).toBe("Return policy");
    expect(contents).toEqual([{ uri: "carrier://policies/returns", mimeType: "text/markdown", text: "Returns are free within 30 days." }]);

    const refusal = (promise: Promise<unknown>) => promise.then(() => undefined, (error: AgentError) => [error.status, error.code, error.message]);
    expect(await refusal(manager.readResource({ server: "carrier", uri: "carrier://secrets" }, ["support"]))).toEqual([
      400,
      "mcp_unknown",
      'carrier offers nothing called "carrier://secrets".',
    ]);
    expect(await refusal(manager.readResource({ server: "carrier", uri: "carrier://policies/returns" }, ["admin"]))).toEqual([
      400,
      "mcp_unavailable",
      "The carrier integration isn't available right now.",
    ]);
    expect(await refusal(manager.readResource({ server: "carrier", uri: "carrier://labels/sample" }, ["support"]))).toEqual([
      502,
      "mcp_failed",
      'Reading "sample-label" from carrier failed: Label printer offline',
    ]);
  });

  it("gets a prompt with the arguments it declares, and asks for required ones", async () => {
    const { manager, server } = await connect();

    const { content, arguments: values } = await manager.getPrompt("carrier", "delay_notice", { trackingNumber: " AC123 ", extra: "x", tone: "" }, []);
    expect(values).toEqual({ trackingNumber: "AC123" });
    expect(server.calls.find((c) => c.method === "prompts/get")!.params).toEqual({ name: "delay_notice", arguments: { trackingNumber: "AC123" } });
    expect(content).toEqual([
      { type: "text", text: "Draft a friendly delay notice for AC123 (delay_notice)." },
      { type: "text", text: "Returns are free." },
    ]);

    await expect(manager.getPrompt("carrier", "delay_notice", { tone: "formal" }, [])).rejects.toMatchObject({
      status: 400,
      message: 'The prompt "Delay notice" needs a value for trackingNumber.',
    });
    await expect(manager.getPrompt("carrier", "nope", {}, [])).rejects.toBeInstanceOf(AgentError);
  });

  it("lists templates and reads one with values for its variables", async () => {
    const { manager, server } = await connect();
    expect(manager.resourceTemplates([])).toEqual([
      {
        server: "carrier",
        uriTemplate: "carrier://shipments/{trackingNumber}{?events}",
        name: "Shipment",
        mimeType: "application/json",
        description: undefined,
        completes: true,
      },
    ]);
    expect(manager.prompts([])[0]!.completes).toBe(true);

    const template = "carrier://shipments/{trackingNumber}{?events}";
    const { resource } = await manager.readResource({ server: "carrier", template, variables: { trackingNumber: " AC 123 ", other: "x" } }, []);
    expect(resource).toEqual({ server: "carrier", uri: "carrier://shipments/AC%20123", name: "Shipment: AC 123", mimeType: "application/json" });
    expect(server.calls.at(-1)).toEqual({ method: "resources/read", params: { uri: "carrier://shipments/AC%20123" } });
    await expect(manager.readResource({ server: "carrier", template, variables: { events: "all" } }, [])).rejects.toMatchObject({
      code: "mcp_template_variable",
      message: 'The resource "Shipment" needs a value for trackingNumber.',
    });
  });

  it("asks the server for suggestions, and gets none from one that makes none", async () => {
    const { manager, server } = await connect();
    const template = "carrier://shipments/{trackingNumber}{?events}";
    expect(await manager.complete({ server: "carrier", template, argument: "trackingNumber", value: "AC" }, [])).toEqual(["AC123", "AC124"]);
    expect(await manager.complete({ server: "carrier", prompt: "delay_notice", argument: "trackingNumber", value: "B", context: { tone: "formal" } }, [])).toEqual([
      "BX900",
    ]);
    expect(server.calls.at(-1)!.params).toEqual({
      ref: { type: "ref/prompt", name: "delay_notice" },
      argument: { name: "trackingNumber", value: "B" },
      context: { arguments: { tone: "formal" } },
    });
    await expect(manager.complete({ server: "carrier", template: "carrier://other/{id}", argument: "id", value: "" }, [])).rejects.toMatchObject({ code: "mcp_unknown" });

    const plain = fakeMcpServer({ prompts: {} }, { "tools/list": () => ({ tools: [] }), "prompts/list": () => ({ prompts: [{ name: "p", arguments: [{ name: "a" }] }] }) });
    const other = new TestMcpManager();
    other.transports.set("plain", plain.transport);
    managers.push(other);
    await other.connect("plain", { command: "unused" }, false);
    expect(await other.complete({ server: "plain", prompt: "p", argument: "a", value: "" }, [])).toEqual([]);
    expect(plain.calls.map((c) => c.method)).not.toContain("completion/complete");
  });

  it("gives the model resource tools that follow the server's roles and any link a tool returns", async () => {
    const { manager } = await connect({ roles: ["support"] });
    const [list, read] = resourceTools(manager);
    const ctx = (roles: string[]) => ({ user: { id: "u", name: "U", roles }, signal: new AbortController().signal }) as unknown as ToolContext;

    expect(manager.canRead(["support"])).toBe(true);
    expect(manager.canRead(["admin"])).toBe(false);
    const listed = (await list!.execute({}, ctx(["support"]))) as string;
    expect(listed).toContain("- Return policy (server carrier) carrier://policies/returns");
    expect(listed).toContain("- Shipment (server carrier, template) carrier://shipments/{trackingNumber}{?events}");
    expect(await list!.execute({}, ctx(["admin"]))).toMatch(/^No resources are listed/);

    // The tool's link names its server, and reading it needs no listing.
    const link = await manager.tools()[0]!.execute({}, ctx(["support"]));
    expect((link as { text: string }).text).toBe("Resource link: Return label RTN-1 (carrier://labels/RTN-1) on the carrier server. Read it with read_resource if you need it.");
    const label = (await read!.execute({ server: "carrier", uri: "carrier://labels/RTN-1" }, ctx(["support"]))) as { text: string };
    expect(label.text).toBe('<mcp-resource server="carrier" uri="carrier://labels/RTN-1" name="carrier://labels/RTN-1">\nLabel carrier://labels/RTN-1\n</mcp-resource>');
    await expect(read!.execute({ server: "carrier", uri: "carrier://labels/RTN-1" }, ctx(["admin"]))).rejects.toMatchObject({ code: "mcp_unavailable" });
  });
});

describe("resourceContent", () => {
  const resource: McpResourceInfo = { server: "carrier", uri: 'carrier://a?b="c"', name: "A & B", mimeType: "text/plain" };

  it("puts the contents in a tag that says where they came from", () => {
    expect(resourceContent(resource, [{ uri: resource.uri, text: "Hello" }], false)).toEqual([
      { type: "text", text: '<mcp-resource server="carrier" uri="carrier://a?b=&quot;c&quot;" name="A &amp; B" mime-type="text/plain">\nHello\n</mcp-resource>' },
    ]);
  });

  it("attaches images for a model that can see them, mentions other binary contents and cuts long text", () => {
    const png = { uri: "carrier://label.png", mimeType: "image/png", blob: "iVBORw0KGgo=" };
    expect(resourceContent(resource, [png], true)).toEqual([
      { type: "text", text: expect.stringContaining("(the image carrier://label.png, attached after this)") },
      { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
    ]);
    expect(resourceContent(resource, [png], false)).toEqual([{ type: "text", text: expect.stringContaining("(binary content of type image/png, not included)") }]);
    const [long] = resourceContent(resource, [{ uri: resource.uri, text: "x".repeat(50_000) }], false);
    expect(long).toMatchObject({ text: expect.stringContaining("… (cut at 40000 characters)") });
    expect((long as { text: string }).text.length).toBeLessThan(41_000);
  });
});

describe("mcpToolFlags", () => {
  const tool = (name: string, annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }) => ({ name, annotations });

  it("follows the tool's annotations by default", () => {
    expect(mcpToolFlags({}, tool("list_orders", { readOnlyHint: true }))).toEqual({ readOnly: true, approval: false });
    expect(mcpToolFlags({}, tool("delete_order", { destructiveHint: true }))).toEqual({ readOnly: false, approval: true });
    expect(mcpToolFlags({}, tool("update_order"))).toEqual({ readOnly: false, approval: false });
  });

  it("lets server config override them with a list or a predicate", () => {
    const readOnly = (name: string) => /^(list|get)_/.test(name);
    const approval = (name: string) => !readOnly(name);
    expect(mcpToolFlags({ readOnly, approval }, tool("get_article"))).toEqual({ readOnly: true, approval: false });
    expect(mcpToolFlags({ readOnly, approval }, tool("publish_article"))).toEqual({ readOnly: false, approval: true });
    expect(mcpToolFlags({ approval: ["refund"] }, tool("refund", { readOnlyHint: true }))).toEqual({ readOnly: true, approval: true });
    expect(mcpToolFlags({ approval: false }, tool("wipe", { destructiveHint: true }))).toEqual({ readOnly: false, approval: false });
  });
});

describe("structuredUi", () => {
  // The shape of Strapi's media_list_assets and media_get_asset results.
  const asset = {
    id: 1,
    name: "cover.png",
    alternativeText: null,
    caption: null,
    url: "/uploads/cover_29f3756a8e.png",
    mime: "image/png",
    size: 535.79,
    width: 1024,
    height: 1024,
    ext: ".png",
    folder: null,
  };

  it("shows files as a gallery", () => {
    expect(structuredUi({ results: [asset], pagination: { page: 1, total: 1 } })).toEqual([
      {
        type: "media",
        title: "Results",
        items: [{ url: "/uploads/cover_29f3756a8e.png", name: "cover.png", mime: "image/png", width: 1024, height: 1024 }],
      },
    ]);
    expect(structuredUi({ data: asset })).toEqual([{ type: "media", items: [expect.objectContaining({ name: "cover.png" })] }]);
    expect(structuredUi([{ url: "https://cdn.example.com/a.webp" }])?.[0]?.type).toBe("media");
  });

  it("shows other records, links included, as a table", () => {
    const links = { results: [{ title: "Quick start", url: "https://docs.strapi.io/cms/quick-start" }] };
    expect(structuredUi(links)).toEqual([expect.objectContaining({ type: "table", title: "Results" })]);
    expect(structuredUi({ data: { id: 1, name: "Folder" } })).toBeUndefined();
  });
});
