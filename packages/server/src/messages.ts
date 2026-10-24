import { matchLocale } from "@klymbak/protocol";
import { createTranslator } from "./i18n.ts";
import de from "./locales/de.ts";
import es from "./locales/es.ts";
import fr from "./locales/fr.ts";
import it from "./locales/it.ts";
import ja from "./locales/ja.ts";
import ko from "./locales/ko.ts";
import nl from "./locales/nl.ts";
import pl from "./locales/pl.ts";
import ptBR from "./locales/pt-BR.ts";
import tr from "./locales/tr.ts";
import uk from "./locales/uk.ts";
import zhHans from "./locales/zh-Hans.ts";

/**
 * What the server itself writes for people, in English: built-in tool labels, notices, refusals and API errors.
 * The other languages in `locales/` use the same keys. Text for the model (tool descriptions, results, the
 * prompt) stays in English.
 */
export const en = {
  "app.name": "Assistant",
  "session.title": "New conversation",

  "notice.maxTurns": 'Stopped after {count} steps to stay safe. Say "continue" to let the agent keep going.',
  "notice.noResponse": "The model returned no response.",

  "tool.delegate.label": "Delegate to specialist",
  "tool.delegate.summary": "Hands a task to one of the specialist agents.",
  "tool.skill.label": "Use skill",
  "tool.skill.summary": "Reads a skill's instructions when a task calls for it.",
  "tool.schedule.label": "Schedule a recurring task",
  "tool.schedule.summary": "Sets up a task that runs on a schedule and reports back.",
  "tool.listSchedules.label": "List scheduled tasks",
  "tool.listSchedules.summary": "Shows the recurring tasks you can see.",
  "tool.cancelSchedule.label": "Cancel a scheduled task",
  "tool.cancelSchedule.summary": "Deletes a recurring task you created.",

  "schedule.created": "Scheduled task created",
  "schedule.list": "Scheduled tasks",
  "schedule.task": "Task",
  "schedule.cron": "Schedule",
  "schedule.nextRun": "Next run",
  "schedule.prompt": "Prompt",
  "schedule.state": "State",
  "schedule.active": "Active",
  "schedule.paused": "Paused",

  "refused.role": "This needs the {roles} role.",
  "refused.hookFailed": "The {hook} policy check failed, so this wasn't run.",
  "refused.policy": "Blocked by policy ({hook}): {reason}",
  "refused.policyNoReason": "Blocked by policy ({hook}).",
  "refused.headless": "This needs a person's approval, and nobody was there to give it.",
  "refused.aborted": "The run was stopped before anyone approved this.",
  "refused.expired": "Nobody approved this in time.",
  "refused.denied": "Denied.",
  "refused.deniedReason": 'Denied: "{reason}"',

  "error.unauthorized": "Sign in to use the assistant.",
  "error.badJson": "The request body is not valid JSON.",
  "error.needsBody": "This request needs a JSON body.",
  "error.internal": "Something went wrong on the server.",
  "error.sessionNotFound": "Conversation not found.",
  "error.scheduleNotFound": "Schedule not found.",
  "error.notOwner": "Only the owner can delete this conversation.",
  "error.busy": "The agent is still working on this conversation. Wait for it or stop it first.",
  "error.emptyPrompt": "Type a message first.",
  "error.idle": "The agent isn't running, so send this as a normal message.",
  "error.approvalGone": "This approval is no longer waiting for a decision.",
  "error.approvalsPending": "An action here is waiting for approval. Approve or deny it first.",
  "error.unknownAgent": 'Unknown agent "{agent}".',
  "error.noScheduler": "Scheduling is turned off on this server.",
  "error.scheduleFields": "A schedule needs a name and a prompt.",
  "error.builtinSchedulePatch": "Built-in schedules can only be paused or resumed.",
  "error.builtinScheduleDelete": "Built-in schedules can't be deleted. Pause them instead.",
  "error.scheduleRunning": "This task is already running.",
  "error.invalidCron": 'Invalid cron expression "{expression}": {error}',
  "error.scheduleForbidden": "Only the owner or an admin can change this schedule.",
  "error.cantAddMcp": "You can't add integrations.",
  "error.cantRemoveMcp": "You can't remove integrations.",
  "error.mcpUrl": "Enter a full URL, e.g. https://mcp.example.com/mcp.",
  "error.mcpHttpOnly": "Only HTTP(S) MCP servers can be added at runtime.",
  "error.mcpExists": '"{name}" is already configured on the server.',
  "error.mcpNotRuntime": "Only integrations added at runtime can be removed here.",
  "error.noModels":
    "No language model is configured. Set a provider API key (e.g. ANTHROPIC_API_KEY) or configure a local OpenAI-compatible server.",
  "error.modelUnavailable": "Model {model} is not available.",
};

export type ServerMessageId = keyof typeof en;
export type ServerMessages = Record<ServerMessageId, string>;

/** The server's own messages in a person's language. */
export const t = createTranslator(en, { de, es, fr, it, ja, ko, nl, pl, "pt-BR": ptBR, tr, uk, "zh-Hans": zhHans });

/** "editor or admin" in the sentence's language, which is English when the person's has no messages. */
export function roleList(roles: string[], locale: string | undefined): string {
  return new Intl.ListFormat(matchLocale(locale, t.locales) ?? "en", { type: "disjunction" }).format(roles);
}
