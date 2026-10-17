<script setup lang="ts">
import { onBeforeUnmount, reactive, ref, toRaw } from "vue";
import {
  applyEvent,
  MessageList,
  provideAgentStore,
  type AgentEvent,
  type AgentStore,
  type ApprovalDecision,
  type ChatMessage,
  type ToolPart,
  type UiBlock,
} from "@klymbak/vue";

/**
 * The real @klymbak/vue components, replaying a scripted session.
 * The run pauses at the approval card until the visitor decides.
 */
const props = defineProps<{ theme: "auto" | "light" | "dark" }>();

type Step =
  | { wait: number; event: AgentEvent }
  | { wait: number; text: string; messageId: string; index: number }
  | { wait: number; finish: string }
  | { wait: number; approval: true };

const PROMPT = "Jane Cooper's tent arrived with a torn rainfly. Refund the tent and send her a return label.";
const APPROVAL = {
  id: "replay-approval",
  title: "Refund $329.00 to Jane Cooper",
  description: "Order #2691 (Ridgeline 2P Tent). Reason: torn rainfly on arrival.",
  risk: "high" as const,
  status: "pending" as const,
};

const user = (id: string, text: string): ChatMessage => ({ id, role: "user", parts: [{ type: "text", text }], createdAt: 0, status: "done" });
const assistant = (id: string): ChatMessage => ({ id, role: "assistant", parts: [], createdAt: 0, status: "streaming", model: { provider: "anthropic", id: "claude-sonnet-5-5" } });
const tool = (toolCallId: string, name: string, label: string, args: Record<string, unknown>, extra: Partial<ToolPart> = {}): ToolPart => ({
  type: "tool",
  toolCallId,
  name,
  label,
  args,
  status: "streaming",
  ...extra,
});
const done = (id: string, text: string, ui?: UiBlock[], ms = 140): AgentEvent => ({
  type: "tool_update",
  toolCallId: id,
  patch: { status: "done", durationMs: ms, result: { text, ui, isError: false } },
});
const end = (id: string): Step => ({ wait: 0, finish: id });

const BEFORE_APPROVAL: Step[] = [
  { wait: 0, event: { type: "message_start", message: user("u1", PROMPT) } },
  { wait: 450, event: { type: "message_start", message: assistant("a1") } },
  { wait: 250, event: { type: "part_start", messageId: "a1", index: 0, part: tool("t1", "get_customer", "Customer profile", { email: "jane.cooper@example.com" }) } },
  { wait: 120, event: { type: "part_start", messageId: "a1", index: 1, part: tool("t2", "list_tickets", "Support tickets", { customerEmail: "jane.cooper@example.com" }) } },
  { wait: 200, event: { type: "tool_update", toolCallId: "t1", patch: { status: "running" } } },
  { wait: 0, event: { type: "tool_update", toolCallId: "t2", patch: { status: "running" } } },
  { wait: 650, event: done("t1", "Jane Cooper, VIP, 29 orders.", undefined, 38) },
  { wait: 120, event: done("t2", "#39 urgent: Tent arrived with a torn rainfly (order #2691).", undefined, 22) },
  { wait: 300, event: { type: "message_start", message: assistant("a2") } },
  { wait: 0, event: { type: "part_start", messageId: "a2", index: 0, part: { type: "text", text: "" } } },
  { wait: 200, text: "Order #2691 has the Ridgeline 2P tent at $329. I'll refund it and send a prepaid return label.", messageId: "a2", index: 0 },
  { wait: 250, event: { type: "part_start", messageId: "a2", index: 1, part: tool("t3", "refund_order", "Refund order", { orderId: 2691, amount: 329, reason: "Torn rainfly on arrival" }) } },
  { wait: 450, event: { type: "tool_update", toolCallId: "t3", patch: { status: "awaiting_approval", approval: APPROVAL } } },
  { wait: 0, approval: true },
];

function afterApproval(decision: ApprovalDecision, by: string): Step[] {
  if (!decision.approved) {
    return [
      { wait: 0, event: { type: "tool_update", toolCallId: "t3", patch: { status: "denied", approval: { ...APPROVAL, status: "denied", decidedBy: by, reason: decision.reason }, result: { text: "The user denied this action.", isError: true } } } },
      end("a2"),
      { wait: 300, event: { type: "message_start", message: assistant("a3") } },
      { wait: 0, event: { type: "part_start", messageId: "a3", index: 0, part: { type: "text", text: "" } } },
      { wait: 150, text: "Understood, no refund. Should I offer Jane a replacement tent with express shipping instead, or a **20% goodwill code** for her next order?", messageId: "a3", index: 0 },
      end("a3"),
    ];
  }
  return [
    { wait: 0, event: { type: "tool_update", toolCallId: "t3", patch: { status: "running", approval: { ...APPROVAL, status: "approved", decidedBy: by } } } },
    { wait: 500, event: done("t3", "Refunded $329.00.", [{ type: "alert", tone: "success", title: "Refund issued", text: "$329.00 refunded to Jane Cooper for order #2691." }], 412) },
    { wait: 250, event: { type: "part_start", messageId: "a2", index: 2, part: tool("t4", "carrier_create_return_label", "Create return label", { orderId: 2691, reason: "Damaged tent" }, { source: "mcp", server: "carrier" }) } },
    { wait: 250, event: { type: "tool_update", toolCallId: "t4", patch: { status: "running" } } },
    { wait: 700, event: done("t4", "Label RTN-2691 emailed to jane.cooper@example.com.", undefined, 640) },
    end("a2"),
    { wait: 300, event: { type: "message_start", message: assistant("a3") } },
    { wait: 0, event: { type: "part_start", messageId: "a3", index: 0, part: { type: "text", text: "" } } },
    { wait: 150, text: "Done. **$329.00** is back on Jane's card, and a prepaid UPS return label (RTN-2691) is in her inbox. Want me to reply on ticket #39 and close it?", messageId: "a3", index: 0 },
    end("a3"),
  ];
}

const messages = reactive<ChatMessage[]>([]);
const playing = ref(false);
const waiting = ref(false);
// Until the first replay the button pulses, so the window doesn't read as a screenshot.
const played = ref(false);
let generation = 0;
let decide: ((decision: ApprovalDecision) => void) | undefined;

// A stand-in store: ApprovalPrompt calls store.decide() when the visitor clicks.
provideAgentStore({
  decide: async (_id: string, decision: ApprovalDecision) => decide?.(decision),
} as unknown as AgentStore);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(steps: Step[], token: number, instant: boolean) {
  for (const step of steps) {
    if (token !== generation) return;
    if (!instant && step.wait) await sleep(step.wait);
    if (token !== generation) return;
    if ("event" in step) applyEvent(messages, step.event);
    else if ("finish" in step) {
      // message_end is authoritative, so it carries the message's full parts.
      const message = messages.find((m) => m.id === step.finish);
      if (message) applyEvent(messages, { type: "message_end", message: { ...structuredClone(toRaw(message)), status: "done" } });
    } else if ("text" in step) {
      if (instant) applyEvent(messages, { type: "part_delta", messageId: step.messageId, index: step.index, delta: step.text });
      else {
        for (const chunk of step.text.match(/.{1,4}/gs) ?? []) {
          if (token !== generation) return;
          applyEvent(messages, { type: "part_delta", messageId: step.messageId, index: step.index, delta: chunk });
          await sleep(16);
        }
      }
    }
  }
}

/** Resting state: the finished conversation, so the hero is complete without playing. */
async function showFinished() {
  const token = ++generation;
  messages.splice(0);
  await run(BEFORE_APPROVAL, token, true);
  await run(afterApproval({ approved: true }, "Olivia Hart"), token, true);
}

async function replay() {
  const token = ++generation;
  messages.splice(0);
  playing.value = true;
  played.value = true;
  await run(BEFORE_APPROVAL, token, false);
  if (token !== generation) return;
  waiting.value = true;
  const decision = await new Promise<ApprovalDecision>((resolve) => (decide = resolve));
  decide = undefined;
  waiting.value = false;
  if (token !== generation) return;
  await run(afterApproval(decision, "You"), token, false);
  if (token === generation) playing.value = false;
}

void showFinished();
onBeforeUnmount(() => {
  generation++;
});
</script>

<template>
  <figure class="replay" aria-label="A recorded agent session you can replay">
    <div class="replay__bar">
      <span class="replay__dots" aria-hidden="true"><i /><i /><i /></span>
      <span class="replay__title">Acme Back Office</span>
      <span class="replay__user">Olivia Hart · admin</span>
    </div>
    <div class="kl-root replay__screen" :data-kl-theme="props.theme">
      <MessageList :messages="messages" :running="playing" />
    </div>
    <figcaption class="replay__caption">
      <span v-if="waiting" class="replay__cue">Your turn: approve or deny the refund ↑</span>
      <span v-else class="replay__note">Live <code>@klymbak/vue</code> components. Replay the run and approve the refund yourself.</span>
      <button type="button" class="replay__play" :class="{ 'replay__play--hint': !played }" :disabled="playing && !waiting" @click="replay">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor" /></svg>
        {{ playing ? "Playing…" : "Replay the run" }}
      </button>
    </figcaption>
  </figure>
</template>

<style scoped>
.replay {
  margin: 0;
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 600px;
  border: 1.5px solid var(--ink);
  border-radius: 12px;
  overflow: hidden;
  background: var(--paper-raised);
  box-shadow: 10px 10px 0 -1px var(--rule-strong);
  min-width: 0;
}
.replay__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1.5px solid var(--ink);
  font-family: var(--font-mono);
  font-size: 0.74rem;
  letter-spacing: 0.04em;
}
.replay__dots {
  display: flex;
  gap: 5px;
}
.replay__dots i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid var(--ink);
}
.replay__title {
  font-weight: 600;
}
.replay__user {
  margin-left: auto;
  color: var(--ink-faint);
}
.replay__screen {
  display: flex;
  flex-direction: column;
  min-height: 0;
  --kl-font: var(--font-body);
  --kl-font-mono: var(--font-mono);
  --kl-text-size: 13.5px;
  --kl-content-width: 100%;
  --kl-bg: var(--paper-raised);
  --kl-surface: var(--paper-raised);
  --kl-accent: var(--signal);
  --kl-accent-hover: var(--signal);
  --kl-accent-text: var(--signal-ink);
  --kl-focus: var(--signal);
}
.replay__screen :deep(.kl-list__inner) {
  padding: 16px;
  gap: 14px;
}
.replay__caption {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-top: 1.5px solid var(--ink);
  font-size: 0.84rem;
}
.replay__note {
  color: var(--ink-soft);
}
.replay__note code {
  font-size: 0.8rem;
}
.replay__cue {
  font-weight: 600;
  color: var(--signal);
}
.replay__play {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  padding: 8px 16px;
  border: 1.5px solid var(--signal);
  border-radius: 999px;
  background: var(--signal);
  color: var(--signal-ink);
  font: inherit;
  font-weight: 600;
  font-size: 0.88rem;
  white-space: nowrap;
  cursor: pointer;
  transition: transform 0.12s ease;
}
.replay__play:not(:disabled):hover {
  transform: translateY(-1px);
}
.replay__play:disabled {
  opacity: 0.55;
  cursor: default;
}
.replay__play--hint {
  animation: replay-pulse 1.8s ease-out infinite;
}
@keyframes replay-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--signal) 55%, transparent);
  }
  70%,
  100% {
    box-shadow: 0 0 0 10px color-mix(in srgb, var(--signal) 0%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .replay__play--hint {
    animation: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--signal) 35%, transparent);
  }
}
@media (max-width: 560px) {
  .replay {
    height: 560px;
    box-shadow: 6px 6px 0 -1px var(--rule-strong);
  }
  .replay__user {
    display: none;
  }
  .replay__caption {
    flex-wrap: wrap;
  }
}
</style>
