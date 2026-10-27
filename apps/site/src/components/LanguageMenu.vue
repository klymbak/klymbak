<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { languageName, locale, localeHref, locales, text } from "../content.ts";

/** The header's language menu: each locale's home page, named in its own language. */
const menu = ref<HTMLDetailsElement>();

// Close when the visitor clicks elsewhere or presses Escape.
function close(event: Event) {
  if (!menu.value?.open) return;
  if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.value.contains(event.target as Node)) menu.value.open = false;
}
onMounted(() => {
  document.addEventListener("click", close);
  document.addEventListener("keydown", close);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", close);
  document.removeEventListener("keydown", close);
});
</script>

<template>
  <details ref="menu" class="lang">
    <summary :aria-label="`${text('common', 'language.label')}: ${languageName(locale)}`" :title="text('common', 'language.label')">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5s1.2-6.1 3.6-8.5z" />
      </svg>
      <span>{{ locale.toUpperCase() }}</span>
    </summary>
    <ul class="lang__list">
      <li v-for="code in locales" :key="code">
        <a :href="localeHref(code)" :hreflang="code" :lang="code" :aria-current="code === locale ? 'page' : undefined">{{ languageName(code) }}</a>
      </li>
    </ul>
  </details>
</template>

<style scoped>
.lang {
  position: relative;
}
.lang summary {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--rule-strong);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  list-style: none;
}
.lang summary::-webkit-details-marker {
  display: none;
}
.lang__list {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  min-width: 11rem;
  margin: 0;
  padding: 6px;
  list-style: none;
  border: 1.5px solid var(--ink);
  border-radius: 10px;
  background: var(--paper-raised);
  box-shadow: 6px 6px 0 -1px var(--rule-strong);
}
.lang__list a {
  display: block;
  padding: 7px 10px;
  border-radius: 6px;
  text-decoration: none;
  font-size: 0.92rem;
}
.lang__list a:hover {
  background: var(--paper);
}
.lang__list a[aria-current] {
  font-weight: 600;
  color: var(--signal);
}
/* Phones: the globe alone; the summary's label still names the language. */
@media (max-width: 420px) {
  .lang summary {
    justify-content: center;
    width: 38px;
    padding: 0;
  }
  .lang summary span {
    display: none;
  }
}
</style>
