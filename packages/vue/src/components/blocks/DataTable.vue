<script setup lang="ts">
import { computed, ref } from "vue";
import type { TableBlock, TableColumn } from "@klymbak/protocol";
import { useChatActions } from "../../context";
import { fillTemplate, formatValue, toneClass } from "@klymbak/client";
import KlIcon from "../KlIcon.vue";

const props = defineProps<{ block: TableBlock }>();
const actions = useChatActions();

const PAGE = 10;
const expanded = ref(false);
const sortKey = ref<string | null>(null);
const sortDir = ref<1 | -1>(1);
const copied = ref(false);

const numeric = (column: TableColumn) => ["number", "integer", "currency", "percent"].includes(column.format ?? "");

const sorted = computed(() => {
  const rows = [...props.block.rows];
  const key = sortKey.value;
  if (!key) return rows;
  return rows.sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (x === y) return 0;
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sortDir.value;
  });
});

const visible = computed(() => (expanded.value ? sorted.value : sorted.value.slice(0, PAGE)));
const hidden = computed(() => props.block.rows.length - visible.value.length);
const total = computed(() => props.block.totalRows ?? props.block.rows.length);

function sortBy(column: TableColumn) {
  if (sortKey.value === column.key) {
    if (sortDir.value === 1) sortDir.value = -1;
    else sortKey.value = null;
  } else {
    sortKey.value = column.key;
    sortDir.value = numeric(column) ? -1 : 1;
  }
}

function align(column: TableColumn) {
  return column.align ?? (numeric(column) ? "right" : "left");
}

async function copyCsv() {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [
    props.block.columns.map((c) => escape(c.label)).join(","),
    ...sorted.value.map((row) => props.block.columns.map((c) => escape(row[c.key])).join(",")),
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    // Clipboard access can be refused; nothing else to do.
  }
}
</script>

<template>
  <div class="kl-table">
    <div v-if="block.title || block.rows.length" class="kl-table__bar">
      <span class="kl-table__title">{{ block.title }}</span>
      <span class="kl-table__count kl-num">{{ total.toLocaleString() }} {{ total === 1 ? "row" : "rows" }}</span>
      <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" :title="'Copy as CSV'" @click="copyCsv">
        <KlIcon :name="copied ? 'check' : 'copy'" :size="14" />
        {{ copied ? "Copied" : "CSV" }}
      </button>
    </div>
    <div class="kl-table__scroll kl-scroll">
      <table>
        <thead>
          <tr>
            <th
              v-for="column in block.columns"
              :key="column.key"
              :style="{ textAlign: align(column) }"
              :aria-sort="sortKey === column.key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'"
            >
              <button type="button" class="kl-table__sort" @click="sortBy(column)">
                {{ column.label }}
                <KlIcon v-if="sortKey === column.key" :name="sortDir === 1 ? 'arrowUp' : 'arrowDown'" :size="12" />
              </button>
            </th>
            <th v-if="block.rowActions?.length" class="kl-table__actions-head"><span class="kl-sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in visible" :key="block.rowKey ? String(row[block.rowKey]) : i">
            <td v-for="column in block.columns" :key="column.key" :style="{ textAlign: align(column) }" :class="{ 'kl-num': numeric(column) }">
              <span
                v-if="column.format === 'badge' && row[column.key] != null"
                class="kl-pill"
                :class="toneClass(column.tones?.[String(row[column.key])])"
              >{{ row[column.key] }}</span>
              <span v-else-if="column.format === 'code'" class="kl-code">{{ column.key === 'id' && typeof row[column.key] === 'number' ? `#${row[column.key]}` : row[column.key] }}</span>
              <span v-else-if="column.format === 'email'" class="kl-table__email">{{ row[column.key] }}</span>
              <template v-else>{{ formatValue(row[column.key], column.format, column.currency) }}</template>
            </td>
            <td v-if="block.rowActions?.length" class="kl-table__row-actions">
              <button
                v-for="action in block.rowActions"
                :key="action.label"
                type="button"
                class="kl-btn kl-btn--sm"
                @click="action.prompt ? actions.sendPrompt(fillTemplate(action.prompt, row)) : actions.emitAction({ ...action, payload: row })"
              >
                {{ action.label }}
              </button>
            </td>
          </tr>
          <tr v-if="!block.rows.length">
            <td :colspan="block.columns.length + (block.rowActions?.length ? 1 : 0)" class="kl-table__empty">No rows</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="hidden > 0 || expanded || block.caption || total > block.rows.length" class="kl-table__foot">
      <button v-if="hidden > 0" type="button" class="kl-btn kl-btn--ghost kl-btn--sm" @click="expanded = true">
        Show {{ hidden }} more
      </button>
      <button v-else-if="expanded && block.rows.length > PAGE" type="button" class="kl-btn kl-btn--ghost kl-btn--sm" @click="expanded = false">
        Show fewer
      </button>
      <span v-if="total > block.rows.length" class="kl-faint">Showing {{ block.rows.length }} of {{ total.toLocaleString() }}</span>
      <span v-if="block.caption" class="kl-faint kl-table__caption">{{ block.caption }}</span>
    </div>
  </div>
</template>
