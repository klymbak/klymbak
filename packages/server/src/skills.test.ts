import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxProvider, fauxToolCall, type Context, type FauxProviderHandle } from "@earendil-works/pi-ai";
import type { ToolPart } from "@klymbak/protocol";
import { AgentRuntime } from "./runtime.ts";
import { loadSkills, parseSkill } from "./skills.ts";
import type { AgentUser, SkillDefinition } from "./types.ts";

const editor: AgentUser = { id: "u1", name: "Eve Editor", roles: ["editor"] };
const intern: AgentUser = { id: "u2", name: "Ian Intern", roles: ["intern"] };
const quiet = { info() {}, warn() {}, error() {} };
/** The system prompt as the model got it: pi-ai keeps it as the transcript's first message. */
const systemPrompt = (context: Context) => JSON.stringify(context.messages.filter((m) => m.role === "system"));

const writeArticle: SkillDefinition = {
  name: "write-article",
  description: "How we write blog articles. Use when drafting or rewriting an article.",
  instructions: "Open with the point. One idea per paragraph. See tone.md.",
  files: { "tone.md": "Plain words, no exclamation marks." },
};
const publishChecklist: SkillDefinition = {
  name: "pre-publish-checklist",
  description: "Checks to run before publishing. Use when asked to publish or review a draft.",
  instructions: "1. Title under 60 characters.\n2. A category is set.",
  roles: ["editor"],
};

describe("SKILL.md", () => {
  it("reads name, description and instructions", () => {
    const skill = parseSkill("---\nname: write-article\ndescription: How we write. Use when drafting.\n---\n\n# Writing\n\nShort sentences.\n");
    expect(skill).toEqual({ name: "write-article", description: "How we write. Use when drafting.", instructions: "# Writing\n\nShort sentences." });
  });

  it("understands quoted, folded and continued values, and ignores other keys", () => {
    const skill = parseSkill(
      [
        "---",
        "name: 'tone'",
        "description: >",
        "  How we sound.",
        "  Use when writing anything public.",
        "license: MIT",
        "metadata:",
        "  author: Field Notes",
        "---",
        "Warm, plain, specific.",
      ].join("\r\n"),
    );
    expect(skill).toMatchObject({ name: "tone", description: "How we sound. Use when writing anything public.", instructions: "Warm, plain, specific." });
    expect(parseSkill('---\nname: x\ndescription: "Says \\"hi\\": use when greeting"\n---\nHi').description).toBe('Says "hi": use when greeting');
    expect(parseSkill("---\nname: x\ndescription: Spans\n  two lines\n---\nHi").description).toBe("Spans two lines");
  });

  it("explains what is wrong with a skill it can't use", () => {
    expect(() => parseSkill("# No frontmatter")).toThrow(/frontmatter/);
    expect(() => parseSkill("---\nname: Write Article\ndescription: x\n---\nBody")).toThrow(/lowercase letters/);
    expect(() => parseSkill("---\nname: write\n---\nBody")).toThrow(/description is required/);
    expect(() => parseSkill("---\nname: write\ndescription: x\n---\n")).toThrow(/instructions are empty/);
  });
});

describe("loadSkills", () => {
  let dir: string;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function folder(files: Record<string, string>) {
    dir = await mkdtemp(path.join(tmpdir(), "klymbak-skills-"));
    for (const [name, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
      await writeFile(path.join(dir, name), text);
    }
    return dir;
  }

  it("loads one skill per folder, with the documents it refers to", async () => {
    const skills = await loadSkills(
      await folder({
        "write-article/SKILL.md": "---\nname: write-article\ndescription: How we write. Use when drafting.\n---\nSee reference/tone.md.",
        "write-article/reference/tone.md": "Plain words.",
        "write-article/scripts/check.py": "print('never run')",
        "pre-publish/SKILL.md": "---\nname: pre-publish\ndescription: Checks before publishing.\n---\n1. Title.",
        "drafts/notes.md": "Not a skill: no SKILL.md.",
      }),
    );
    expect(skills.map((skill) => skill.name)).toEqual(["pre-publish", "write-article"]);
    expect(skills[1]!.files).toEqual({ "reference/tone.md": "Plain words." });
    expect(skills[0]!.files).toBeUndefined();
  });

  it("wants each skill named like its folder", async () => {
    await expect(loadSkills(await folder({ "writing/SKILL.md": "---\nname: write-article\ndescription: x\n---\nBody" }))).rejects.toThrow(/must match its folder/);
  });

  it("says which folder it couldn't read", async () => {
    await expect(loadSkills(path.join(tmpdir(), "klymbak-no-such-folder"))).rejects.toThrow(/Can't read the skills folder/);
  });
});

describe("skills in the runtime", () => {
  let faux: FauxProviderHandle;
  let runtime: AgentRuntime;
  afterEach(async () => {
    await runtime?.stop();
  });

  function setup(skills: SkillDefinition[] = [writeArticle, publishChecklist]) {
    faux = fauxProvider({ tokensPerSecond: 0 });
    runtime = new AgentRuntime({ systemPrompt: "You are a test agent.", models: { providers: [faux.provider] }, skills, schedules: false, logger: quiet });
  }

  async function run(user: AgentUser, prompt: string) {
    const session = await runtime.createSession(user);
    await (await runtime.startRun(user, session.id, { prompt }, () => {})).done;
    const detail = await runtime.getSession(user, session.id);
    return detail.messages.flatMap((m) => m.parts.filter((p): p is ToolPart => p.type === "tool"));
  }

  it("lists skills in the prompt and loads one when the model asks", async () => {
    setup();
    let prompt = "";
    let toolResult = "";
    faux.setResponses([
      (context: Context) => {
        prompt = systemPrompt(context);
        return fauxAssistantMessage(fauxToolCall("use_skill", { name: "write-article" }), { stopReason: "toolUse" });
      },
      (context: Context) => {
        toolResult = JSON.stringify(context.messages.at(-1));
        return fauxAssistantMessage(fauxToolCall("use_skill", { name: "write-article", file: "./tone.md" }), { stopReason: "toolUse" });
      },
      fauxAssistantMessage("Drafted."),
    ]);
    const [load, read] = await run(editor, "Draft an article about owls");

    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("- write-article: How we write blog articles. Use when drafting or rewriting an article.");
    expect(prompt).toContain("- pre-publish-checklist: Checks to run before publishing.");
    expect(prompt).not.toContain("One idea per paragraph");
    expect(toolResult).toContain("One idea per paragraph");
    expect(toolResult).toContain("tone.md");
    expect(load).toMatchObject({ name: "use_skill", status: "done" });
    expect(read!.result?.text).toBe("Plain words, no exclamation marks.");
  });

  it("keeps role-restricted skills from people without the role", async () => {
    setup();
    let prompt = "";
    faux.setResponses([
      (context: Context) => {
        prompt = systemPrompt(context);
        return fauxAssistantMessage(fauxToolCall("use_skill", { name: "pre-publish-checklist" }), { stopReason: "toolUse" });
      },
      fauxAssistantMessage("I can't."),
    ]);
    const [attempt] = await run(intern, "Publish the draft");

    expect(prompt).toContain("write-article");
    expect(prompt).not.toContain("pre-publish-checklist");
    expect(attempt!.result).toMatchObject({ isError: true, text: 'There is no skill "pre-publish-checklist". Skills: write-article.' });
    expect((await runtime.configInfo(intern)).skills).toEqual([{ name: "write-article", description: writeArticle.description }]);
    expect((await runtime.configInfo(editor)).skills.map((skill) => skill.name)).toEqual(["write-article", "pre-publish-checklist"]);
  });

  it("offers no skill tool to someone with no skills, or when there are none", async () => {
    setup([publishChecklist]);
    expect(runtime.toolsFor(intern).map((tool) => tool.name)).not.toContain("use_skill");
    expect(runtime.toolsFor(editor).map((tool) => tool.name)).toContain("use_skill");
    expect(runtime.mainPrompt(intern, false)).not.toContain("## Skills");
    setup([]);
    expect(runtime.allTools().map((tool) => tool.name)).not.toContain("use_skill");
  });

  it("refuses duplicate or malformed skills at startup", () => {
    expect(() => setup([writeArticle, writeArticle])).toThrow(/Duplicate skill name/);
    expect(() => setup([{ ...writeArticle, name: "Write_Article" }])).toThrow(/lowercase letters/);
  });
});
