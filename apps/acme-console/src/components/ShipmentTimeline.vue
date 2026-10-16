<script setup lang="ts">
import { computed } from "vue";
import { formatValue, type TableBlock, type ToolPart } from "@klymbak/vue";

/**
 * Custom renderer for the carrier MCP server's track_shipment tool.
 * Registered in App.vue via `renderers.tools`, it replaces the generic table
 * with a timeline: an example of styling third-party tools to fit your product.
 */
const props = defineProps<{ part: ToolPart }>();

const firstLine = computed(() => props.part.result?.text.split("\n")[0] ?? "");
const status = computed(() => /:\s*(.+)$/.exec(firstLine.value)?.[1] ?? "");
const eta = computed(() => props.part.result?.text.split("\n")[1] ?? "");
const events = computed(() => {
  const table = props.part.result?.ui?.find((block): block is TableBlock => block.type === "table");
  return (table?.rows ?? []) as { time: string; location: string; detail: string }[];
});
const tone = computed(() => (status.value.includes("delivered") ? "done" : status.value.includes("delayed") ? "late" : "moving"));

const when = (iso: string) => formatValue(iso, "datetime");
</script>

<template>
  <div v-if="part.result && !part.result.isError" class="shipment" :class="`shipment--${tone}`">
    <div class="shipment__head">
      <span class="shipment__status">{{ status }}</span>
      <span class="shipment__eta">{{ eta }}</span>
    </div>
    <ol class="shipment__events">
      <li v-for="(event, i) in events" :key="i" :class="{ current: i === 0 }">
        <span class="shipment__time">{{ when(event.time) }}</span>
        <span class="shipment__detail">{{ event.detail }}</span>
        <span class="shipment__where">{{ event.location }}</span>
      </li>
    </ol>
  </div>
  <p v-else-if="part.result" class="shipment__error">{{ part.result.text }}</p>
</template>

<style scoped>
.shipment {
  display: grid;
  gap: 10px;
}
.shipment__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}
.shipment__status {
  font-weight: 700;
  text-transform: capitalize;
  font-size: 15px;
}
.shipment--late .shipment__status {
  color: var(--kl-warning);
}
.shipment--done .shipment__status {
  color: var(--kl-success);
}
.shipment__eta {
  font-size: 12.5px;
  color: var(--kl-text-muted);
}
.shipment__events {
  list-style: none;
  margin: 0;
  padding: 0 0 0 14px;
  border-left: 2px solid var(--kl-border);
  display: grid;
  gap: 8px;
}
.shipment__events li {
  position: relative;
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 0 10px;
  font-size: 13px;
}
.shipment__events li::before {
  content: "";
  position: absolute;
  left: -20px;
  top: 5px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--kl-surface);
  border: 2px solid var(--kl-border-strong);
}
.shipment__events li.current::before {
  border-color: var(--kl-accent);
  background: var(--kl-accent);
}
.shipment__time {
  color: var(--kl-text-faint);
  font-variant-numeric: tabular-nums;
}
.shipment__where {
  grid-column: 2;
  font-size: 12px;
  color: var(--kl-text-muted);
}
.shipment__error {
  margin: 0;
  color: var(--kl-danger);
}
@media (max-width: 520px) {
  .shipment__events li {
    grid-template-columns: 1fr;
  }
  .shipment__where {
    grid-column: 1;
  }
}
</style>
