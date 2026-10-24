import { validLocale } from "@klymbak/protocol";
import type { AgentUser, SubagentDefinition } from "./types.ts";

export const HARNESS_GUIDELINES = `## How to work
- Use tools to look things up. Never invent IDs, names, amounts or dates; if a tool can't find something, say so.
- Many tool results are shown to the user as tables, charts or cards. Don't repeat that data in full; summarize what matters and suggest next steps.
- Actions that change data may need the user's approval. The interface asks them automatically when you call the tool, so call it directly instead of asking "are you sure?" in text. Ask in text only when required details are missing.
- Permissions and business rules are enforced by the system when you call a tool, so don't pre-check them or refuse on the user's behalf. If a call is blocked or denied, the result says why: explain briefly and offer an alternative. Don't retry the same call.
- Prefer one well-chosen tool call over many small ones. Independent lookups can run in parallel.
- Be concise. Use short paragraphs, bullet points and markdown tables only when no tool already displayed the data.`;

export function environmentSection(user: AgentUser, timezone: string): string {
  return `## Current user
Name: ${user.name}
Roles: ${user.roles.join(", ") || "none"}
Timezone: ${timezone}`;
}

export function delegationSection(subagents: SubagentDefinition[]): string {
  if (!subagents.length) return "";
  const lines = subagents.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  return `## Delegation
You can hand focused work to specialist agents with the delegate_task tool. Give them a complete, self-contained task; they can't see this conversation. Independent tasks can be delegated in parallel.
${lines}`;
}

export const SCHEDULING_SECTION = `## Scheduled tasks
You can create recurring tasks with schedule_task (cron syntax, in the user's timezone). A scheduled run works unattended: it can read data and notify people, but actions that need approval will be refused, so write those prompts as "check and report".`;

export const HEADLESS_SECTION = `## Unattended run
No one is watching this run. Do the task, then finish with a short report (what you checked, what you found, what needs a person). Actions that need approval will be refused; recommend them in the report instead.`;

/**
 * For an unattended run's turn context: no one writes to the model in their language, so it's told which one the
 * person reading the run uses. "uk" gives "… uses Ukrainian: write everything in it, …".
 */
export function reportLanguage(locale: string | undefined): string | undefined {
  const tag = validLocale(locale);
  if (!tag) return undefined;
  // The base name drops extensions ("-u-ca-…", "-x-…"), which DisplayNames rejects.
  const base = new Intl.Locale(tag).baseName;
  const name = new Intl.DisplayNames(["en"], { type: "language" }).of(base) ?? base;
  return `The person who reads this run uses ${name}: write everything in it, the report included.`;
}

/** Model-only context attached to each user message: the current time. */
export function turnContext(timezone: string, extra?: string): string {
  const now = new Date();
  const local = now.toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return [`<system-context>`, `Current time: ${local} (${timezone}). ISO: ${now.toISOString()}`, extra, `</system-context>`]
    .filter(Boolean)
    .join("\n");
}

export function composePrompt(...sections: (string | undefined | false)[]): string {
  return sections.filter((s): s is string => Boolean(s && s.trim())).join("\n\n");
}
