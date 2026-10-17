import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "./tool.ts";
import type { AgentUser, SkillDefinition, ToolDefinition } from "./types.ts";

export const SKILL_TOOL = "use_skill";

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
/** Documents a skill folder may hold besides SKILL.md. Scripts are left out: nothing runs them. */
const TEXT_FILES = new Set([".md", ".markdown", ".txt", ".csv", ".json", ".yaml", ".yml"]);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_DEPTH = 3;

/** Throws a readable error for a skill the prompt or the tool would choke on. */
export function validateSkill(skill: SkillDefinition, where = `Skill "${skill.name}"`): void {
  if (typeof skill.name !== "string" || !NAME.test(skill.name) || skill.name.length > MAX_NAME) {
    throw new Error(`${where}: the name must be lowercase letters, digits and single hyphens, at most ${MAX_NAME} characters, e.g. "write-article".`);
  }
  if (typeof skill.description !== "string" || !skill.description.trim()) {
    throw new Error(`${where}: a description is required. Say what the skill covers and when to use it.`);
  }
  if (skill.description.length > MAX_DESCRIPTION) throw new Error(`${where}: the description is longer than ${MAX_DESCRIPTION} characters.`);
  if (typeof skill.instructions !== "string" || !skill.instructions.trim()) throw new Error(`${where}: the instructions are empty.`);
}

export function validateSkills(skills: SkillDefinition[]): void {
  const seen = new Set<string>();
  for (const skill of skills) {
    validateSkill(skill);
    if (seen.has(skill.name)) throw new Error(`Duplicate skill name "${skill.name}".`);
    seen.add(skill.name);
  }
}

/**
 * Reads a SKILL.md: YAML frontmatter with `name` and `description`, then the instructions.
 * Covers the frontmatter skills use (plain, quoted and block scalars); other keys are ignored.
 */
export function parseSkill(markdown: string, where = "SKILL.md"): SkillDefinition {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(markdown);
  if (!match) throw new Error(`${where}: it must start with frontmatter between --- lines, holding name and description.`);
  const fields = parseFrontmatter(match[1]!);
  const skill = { name: fields.name ?? "", description: fields.description ?? "", instructions: match[2]!.trim() };
  validateSkill(skill, where);
  return skill;
}

function parseFrontmatter(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const entry = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    if (!entry) continue;
    const [, key, raw] = entry as unknown as [string, string, string];
    // Indented lines that follow belong to this key: a block scalar, a continued plain value, or a nested map.
    const continued: string[] = [];
    while (i + 1 < lines.length && (/^[ \t]+\S/.test(lines[i + 1]!) || (lines[i + 1]!.trim() === "" && /^[ \t]/.test(lines[i + 2] ?? "")))) {
      continued.push(lines[++i]!);
    }
    const value = raw.trim();
    if (/^[>|][+-]?$/.test(value)) {
      const indent = Math.min(...continued.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length));
      const body = continued.map((l) => l.slice(indent));
      fields[key] = (value.startsWith(">") ? body.join(" ").replace(/\s*\n\s*/g, " ") : body.join("\n")).trim();
    } else if (/^"(?:[^"\\]|\\.)*"$/.test(value)) {
      fields[key] = JSON.parse(value) as string;
    } else if (/^'(?:[^']|'')*'$/.test(value)) {
      fields[key] = value.slice(1, -1).replace(/''/g, "'");
    } else if (value) {
      fields[key] = [value, ...continued.map((l) => l.trim())].join(" ").replace(/\s+#.*$/, "").trim();
    }
  }
  return fields;
}

/**
 * Loads every skill under `dir`: one folder per skill, named like the skill, with a SKILL.md and
 * any documents it refers to (Markdown, text, CSV, JSON or YAML). Folders without a SKILL.md are
 * skipped. Read once, so edits need a restart.
 */
export async function loadSkills(dir: string): Promise<SkillDefinition[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Can't read the skills folder ${dir}: ${(error as Error).message}`);
  }
  const skills: SkillDefinition[] = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = path.join(dir, entry.name);
    const file = path.join(folder, "SKILL.md");
    const markdown = await readFile(file, "utf8").catch(() => undefined);
    if (markdown === undefined) continue;
    const skill = parseSkill(markdown, file);
    if (skill.name !== entry.name) throw new Error(`${file}: the name "${skill.name}" must match its folder, "${entry.name}".`);
    const files = await readDocuments(folder);
    skills.push(Object.keys(files).length ? { ...skill, files } : skill);
  }
  validateSkills(skills);
  return skills;
}

async function readDocuments(root: string, dir = root, depth = 0): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < MAX_DEPTH && !entry.name.startsWith(".")) Object.assign(files, await readDocuments(root, full, depth + 1));
      continue;
    }
    const relative = path.relative(root, full).split(path.sep).join("/");
    if (!entry.isFile() || relative === "SKILL.md" || !TEXT_FILES.has(path.extname(entry.name).toLowerCase())) continue;
    if ((await stat(full)).size > MAX_FILE_BYTES) continue;
    files[relative] = await readFile(full, "utf8");
  }
  return files;
}

export function skillsFor(skills: readonly SkillDefinition[], user: AgentUser): SkillDefinition[] {
  return skills.filter((skill) => !skill.roles?.length || skill.roles.some((role) => user.roles.includes(role)));
}

/** The prompt's list of skills: names and descriptions only. */
export function skillsSection(skills: readonly SkillDefinition[]): string {
  if (!skills.length) return "";
  const lines = skills.map((skill) => `- ${skill.name}: ${skill.description.replace(/\s+/g, " ").trim()}`).join("\n");
  return `## Skills
Skills are written instructions for tasks here: procedures, checklists, house rules. When a request matches a skill's description, load it with ${SKILL_TOOL} before you start, and follow it over your own habits. Load only the skills the task needs.
${lines}`;
}

/** use_skill: returns a skill's instructions, or one of its documents. */
export function skillTool(skills: readonly SkillDefinition[]): ToolDefinition<any> {
  return defineTool({
    name: SKILL_TOOL,
    label: "Use skill",
    source: "builtin",
    readOnly: true,
    description:
      "Loads a skill: written instructions for a kind of task (a procedure, checklist or house rules). Call it before starting a task that matches a skill in the Skills list, then follow it. Pass `file` to read a document the skill refers to.",
    parameters: Type.Object({
      name: Type.String({ description: "The skill's name, from the Skills list." }),
      file: Type.Optional(Type.String({ description: 'A document the skill refers to, e.g. "reference/tone.md".' })),
    }),
    execute: async ({ name, file }, ctx) => {
      const available = skillsFor(skills, ctx.user);
      const skill = available.find((candidate) => candidate.name === name);
      if (!skill) {
        const names = available.map((candidate) => candidate.name).join(", ");
        return { text: `There is no skill "${name}".${names ? ` Skills: ${names}.` : ""}`, isError: true };
      }
      const documents = Object.keys(skill.files ?? {});
      if (file) {
        const wanted = file.replace(/\\/g, "/").replace(/^\.\//, "");
        const text = skill.files?.[wanted];
        if (text === undefined) {
          return { text: `The skill "${name}" has no file "${file}".${documents.length ? ` Its files: ${documents.join(", ")}.` : ""}`, isError: true };
        }
        return text;
      }
      const index = documents.length ? `\n\nDocuments in this skill (read one with ${SKILL_TOOL} and \`file\`): ${documents.join(", ")}.` : "";
      return `# Skill: ${skill.name}\n\n${skill.instructions}${index}`;
    },
  });
}
