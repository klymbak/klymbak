<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { humanize, type ToolPart, type ToolStatus } from "@klymbak/protocol";
import { useRenderers } from "../context";
import ApprovalPrompt from "./ApprovalPrompt.vue";
import KlIcon from "./KlIcon.vue";
import SubagentTrace from "./SubagentTrace.vue";
import UiBlockView from "./blocks/UiBlockView.vue";

const props = defineProps<{ part: ToolPart; compact?: boolean }>();
const renderers = useRenderers();

const STATUS: Record<ToolStatus, { label: string; tone: string }> = {
  streaming: { label: "Preparing", tone: "neutral" },
  pending: { label: "Queued", tone: "neutral" },
  awaiting_approval: { label: "Waiting for you", tone: "warning" },
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "success" },
  error: { label: "Failed", tone: "danger" },
  denied: { label: "Denied", tone: "danger" },
  blocked: { label: "Blocked", tone: "danger" },
};

const icon = computed(() => ({ mcp: "plug", builtin: "clock", subagent: "agents", local: "tool" })[props.part.source ?? "local"]);
const status = computed(() => STATUS[props.part.status]);
const active = computed(() => ["streaming", "pending", "running"].includes(props.part.status));
const refused = computed(() => ["error", "denied", "blocked"].includes(props.part.status));
const customRenderer = computed(() => renderers.tools?.[props.part.name]);
const blocks = computed(() => props.part.result?.ui ?? []);
const label = computed(() => props.part.label ?? humanize(props.part.name));

const args = computed(() => {
  const value = props.part.args;
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
    key,
    value: typeof v === "string" ? v : JSON.stringify(v, null, 2),
    long: typeof v === "string" ? v.length > 80 || v.includes("\n") : typeof v === "object",
  }));
});

/** One-line summary of the arguments for the collapsed header. */
const argSummary = computed(() =>
  args.value
    .filter((a) => !a.long)
    .slice(0, 3)
    .map((a) => `${humanize(a.key).toLowerCase()}: ${a.value}`)
    .join(" · "),
);

const open = ref(false);
watch(
  () => props.part.status,
  (now) => {
    if (now === "error" || now === "blocked") open.value = true;
  },
  { immediate: true },
);

const duration = computed(() => {
  const ms = props.part.durationMs;
  if (ms === undefined) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
});
</script>

<template>
  <div class="kl-tool" :class="[`kl-tool--${part.status}`, { 'kl-tool--compact': compact }]">
    <button type="button" class="kl-tool__head" :aria-expanded="open" @click="open = !open">
      <span class="kl-tool__icon" :class="{ 'kl-tool__icon--active': active }">
        <span v-if="active" class="kl-spinner" />
        <KlIcon v-else :name="icon" :size="14" />
      </span>
      <span class="kl-tool__name">{{ label }}</span>
      <span v-if="part.server" class="kl-tool__via">via {{ part.server }}</span>
      <span v-if="argSummary && !part.subagent" class="kl-tool__args">{{ argSummary }}</span>
      <span class="kl-tool__meta">
        <span v-if="duration" class="kl-faint kl-num">{{ duration }}</span>
        <span class="kl-pill" :class="`kl-tone-${status.tone}`">{{ status.label }}</span>
        <KlIcon class="kl-tool__chevron" :class="{ 'kl-tool__chevron--open': open }" name="chevronDown" :size="14" />
      </span>
    </button>

    <div v-if="part.approval" class="kl-tool__section">
      <ApprovalPrompt :approval="part.approval" />
    </div>

    <div v-if="part.progress && active" class="kl-tool__progress kl-faint">{{ part.progress }}</div>

    <div v-if="refused && part.result && !open" class="kl-tool__reason">{{ part.result.text }}</div>

    <div v-if="part.subagent" class="kl-tool__section">
      <SubagentTrace :subagent="part.subagent" :result="part.result?.text" :done="part.status === 'done'" />
    </div>

    <div v-if="customRenderer && part.result" class="kl-tool__section">
      <component :is="customRenderer" :part="part" />
    </div>
    <div v-else-if="blocks.length" class="kl-tool__blocks">
      <UiBlockView v-for="(block, i) in blocks" :key="i" :block="block" />
    </div>

    <div v-if="open" class="kl-tool__details">
      <div v-if="args.length" class="kl-tool__detail">
        <span class="kl-tool__detail-label">Input</span>
        <dl class="kl-tool__argList">
          <template v-for="arg in args" :key="arg.key">
            <dt>{{ humanize(arg.key) }}</dt>
            <dd :class="{ 'kl-tool__argLong': arg.long }">{{ arg.value }}</dd>
          </template>
        </dl>
      </div>
      <div v-if="part.result?.text && !part.subagent" class="kl-tool__detail">
        <span class="kl-tool__detail-label">{{ part.result.isError ? "Error" : "What the agent saw" }}</span>
        <pre class="kl-tool__output kl-scroll">{{ part.result.text }}</pre>
      </div>
      <div class="kl-tool__detail kl-faint kl-tool__ids">
        <span class="kl-code">{{ part.name }}</span>
        <span v-if="part.source === 'mcp'">MCP tool from <strong>{{ part.server }}</strong></span>
      </div>
    </div>
  </div>
</template>
