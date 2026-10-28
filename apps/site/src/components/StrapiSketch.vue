<script setup lang="ts">
import { text } from "../content.ts";

/** A sketch of the Strapi admin, showing where the plugin puts the assistant. Decorative: the text beside it says the same. */
defineProps<{ view: "page" | "panel" | "bulk" }>();

/** The sketch's words, from the "strapi-sketch" UI text. */
const t = (key: string) => text("strapi-sketch", key);
</script>

<template>
  <div class="sk" aria-hidden="true">
    <div class="sk__rail">
      <i v-for="n in 5" :key="n" :class="{ on: view === 'page' && n === 4 }" />
    </div>

    <div v-if="view === 'page'" class="sk__main sk__chat">
      <span class="sk__head">{{ t("assistant") }}</span>
      <span class="sk__bubble" />
      <span class="sk__line" />
      <span class="sk__line sk__line--short" />
      <span class="sk__table"><i v-for="n in 3" :key="n" /></span>
      <span class="sk__composer" />
    </div>

    <div v-else-if="view === 'panel'" class="sk__main sk__split">
      <div class="sk__form">
        <span class="sk__head">{{ t("article") }}</span>
        <template v-for="n in 3" :key="n">
          <span class="sk__label" />
          <span class="sk__input" />
        </template>
      </div>
      <div class="sk__side">
        <span class="sk__head">{{ t("assistant") }}</span>
        <span class="sk__bubble" />
        <span class="sk__line" />
        <span class="sk__approve">{{ t("approve") }}</span>
      </div>
    </div>

    <div v-else class="sk__main sk__list">
      <span class="sk__head">{{ t("articles") }}</span>
      <span v-for="n in 5" :key="n" class="sk__row" :class="{ on: n === 2 || n === 3 }"><i /><b /></span>
      <span class="sk__bar">{{ t("selected") }} · <strong>{{ t("ask") }}</strong></span>
    </div>
  </div>
</template>

<style scoped>
.sk {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  height: 168px;
  border: 1.5px solid var(--ink);
  border-radius: 10px;
  background: var(--paper-raised);
  overflow: hidden;
  font-size: 0.66rem;
  line-height: 1;
}
.sk__rail {
  display: grid;
  align-content: start;
  justify-items: center;
  gap: 9px;
  padding: 10px 0;
  border-right: 1px solid var(--rule);
}
.sk__rail i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: var(--rule);
}
.sk__rail i.on {
  background: var(--signal);
  box-shadow: 0 0 0 3px var(--signal-soft);
}
.sk__main {
  min-width: 0;
  padding: 10px 12px;
}
.sk__head {
  display: block;
  margin-bottom: 4px;
  font-family: var(--font-mono);
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ink-soft);
}
.sk__bubble {
  display: block;
  justify-self: end;
  width: 62%;
  height: 16px;
  border-radius: 8px 8px 2px 8px;
  background: var(--signal-soft);
}
.sk__line {
  display: block;
  height: 7px;
  border-radius: 3px;
  background: var(--rule);
}
.sk__line--short {
  width: 60%;
}

/* A page of its own */
.sk__chat {
  display: grid;
  grid-template-rows: auto auto auto auto 1fr auto;
  gap: 6px;
}
.sk__table {
  display: grid;
  gap: 4px;
  align-content: start;
  padding: 5px;
  border: 1px solid var(--rule-strong);
  border-radius: 5px;
}
.sk__table i {
  height: 6px;
  border-radius: 2px;
  background: var(--rule);
}
.sk__composer {
  height: 18px;
  border: 1px solid var(--rule-strong);
  border-radius: 6px;
}

/* A side panel on every entry */
.sk__split {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.95fr);
  padding: 0;
}
.sk__form {
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 10px 12px;
}
.sk__label {
  width: 40%;
  height: 5px;
  margin-top: 3px;
  border-radius: 2px;
  background: var(--rule-strong);
}
.sk__input {
  height: 16px;
  border: 1px solid var(--rule-strong);
  border-radius: 4px;
}
.sk__side {
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 10px;
  border-left: 1.5px solid var(--signal);
  background: color-mix(in srgb, var(--signal-soft) 45%, var(--paper-raised));
}
.sk__side .sk__head {
  color: var(--signal);
}
.sk__approve {
  justify-self: start;
  margin-top: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  background: var(--signal);
  color: var(--signal-ink);
  font-weight: 600;
}

/* A bulk action */
.sk__list {
  position: relative;
  display: grid;
  align-content: start;
  gap: 0;
}
.sk__row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 20px;
  border-bottom: 1px solid var(--rule);
}
.sk__row i {
  width: 9px;
  height: 9px;
  border: 1.5px solid var(--rule-strong);
  border-radius: 2px;
}
.sk__row.on i {
  border-color: var(--signal);
  background: var(--signal);
}
.sk__row b {
  width: 55%;
  height: 6px;
  border-radius: 2px;
  background: var(--rule);
}
.sk__row.on {
  background: var(--signal-soft);
}
.sk__bar {
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%);
  padding: 6px 10px;
  border-radius: 6px;
  background: var(--signal);
  color: var(--signal-ink);
  white-space: nowrap;
}
.sk__bar strong {
  font-weight: 600;
}
</style>
