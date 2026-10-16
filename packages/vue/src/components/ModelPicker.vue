<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { ModelInfo, ThinkingLevel } from "@klymbak/protocol";
import { useAgentStore } from "../context";
import { formatContext } from "@klymbak/client";
import KlIcon from "./KlIcon.vue";

const props = withDefaults(defineProps<{ placement?: "up" | "down" }>(), { placement: "up" });
const store = useAgentStore();

const open = ref(false);
const query = ref("");
const root = ref<HTMLElement>();
const search = ref<HTMLInputElement>();

const groups = computed(() => {
  const q = query.value.trim().toLowerCase();
  const map = new Map<string, { provider: string; name: string; models: ModelInfo[] }>();
  for (const model of store.models.value) {
    if (q && !`${model.name} ${model.id} ${model.providerName}`.toLowerCase().includes(q)) continue;
    const group = map.get(model.provider) ?? { provider: model.provider, name: model.providerName, models: [] };
    group.models.push(model);
    map.set(model.provider, group);
  }
  return [...map.values()];
});

const current = computed(() => store.currentModel.value);
const levels = computed<ThinkingLevel[]>(() => (current.value?.reasoning ? current.value.thinkingLevels.filter((l) => l !== "minimal") : []));

function isCurrent(model: ModelInfo) {
  return store.state.model?.provider === model.provider && store.state.model?.id === model.id;
}

function choose(model: ModelInfo) {
  store.setModel({ provider: model.provider, id: model.id });
  open.value = false;
}

async function toggle() {
  open.value = !open.value;
  if (open.value) {
    query.value = "";
    await nextTick();
    search.value?.focus();
  }
}

function onOutside(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener("mousedown", onOutside));
onBeforeUnmount(() => document.removeEventListener("mousedown", onOutside));
</script>

<template>
  <div ref="root" class="kl-models" @keydown.escape="open = false">
    <button type="button" class="kl-models__button" :aria-expanded="open" aria-haspopup="listbox" @click="toggle">
      <span class="kl-models__name">{{ current?.name ?? (store.models.value.length ? "Choose a model" : "No models") }}</span>
      <span v-if="current" class="kl-models__provider">{{ current.providerName }}</span>
      <span v-if="current?.reasoning && store.state.thinkingLevel !== 'off'" class="kl-pill kl-tone-accent">think: {{ store.state.thinkingLevel }}</span>
      <KlIcon name="chevronDown" :size="12" />
    </button>
    <div v-if="open" class="kl-models__panel" :class="`kl-models__panel--${props.placement}`" role="listbox">
      <input ref="search" v-model="query" class="kl-input" type="search" placeholder="Search models" aria-label="Search models" />
      <div class="kl-models__groups kl-scroll">
        <div v-for="group in groups" :key="group.provider" class="kl-models__group">
          <span class="kl-models__group-name">{{ group.name }}</span>
          <button
            v-for="model in group.models"
            :key="model.id"
            type="button"
            role="option"
            class="kl-models__option"
            :class="{ 'kl-models__option--active': isCurrent(model) }"
            :aria-selected="isCurrent(model)"
            @click="choose(model)"
          >
            <span class="kl-models__option-name">{{ model.name }}</span>
            <span class="kl-models__badges">
              <span v-if="model.local" class="kl-pill kl-tone-success">local</span>
              <span v-if="model.reasoning" class="kl-pill kl-tone-accent">reasoning</span>
              <span v-if="model.input.includes('image')" class="kl-pill">vision</span>
              <span class="kl-faint kl-num">{{ formatContext(model.contextWindow) }}</span>
            </span>
          </button>
        </div>
        <p v-if="!groups.length" class="kl-models__empty">
          {{ store.models.value.length ? "No models match." : "No providers are configured on the server. Add an API key or a local model server." }}
        </p>
      </div>
      <div v-if="levels.length > 1" class="kl-models__thinking">
        <span>Thinking</span>
        <div class="kl-segmented" role="radiogroup" aria-label="Thinking level">
          <button
            v-for="level in levels"
            :key="level"
            type="button"
            role="radio"
            :aria-checked="store.state.thinkingLevel === level"
            :class="{ active: store.state.thinkingLevel === level }"
            @click="store.setThinkingLevel(level)"
          >
            {{ level }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
