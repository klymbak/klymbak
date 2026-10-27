<script setup lang="ts">
import { lines, text } from "../content.ts";

/** The diagram's words, from the "architecture-diagram" UI text. */
const t = (key: string) => text("architecture-diagram", key);
const [cards1, cards2] = lines(t("app.cards"));
</script>

<template>
  <div class="arch">
    <svg viewBox="0 0 980 420" role="img" aria-labelledby="arch-title arch-desc">
      <title id="arch-title">{{ t("title") }}</title>
      <desc id="arch-desc">{{ t("description") }}</desc>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" class="arch__arrowhead" />
        </marker>
      </defs>

      <!-- Your app -->
      <rect x="10" y="110" width="220" height="200" rx="12" class="arch__box" />
      <text x="30" y="142" class="arch__eyebrow">{{ t("app.eyebrow") }}</text>
      <text x="30" y="172" class="arch__title">{{ t("app.title") }}</text>
      <text x="30" y="198" class="arch__text arch__text--strong">{{ t("app.stacks") }}</text>
      <text x="30" y="220" class="arch__text">{{ t("app.parts") }}</text>
      <text x="30" y="250" class="arch__text">{{ cards1 }}</text>
      <text x="30" y="272" class="arch__text">{{ cards2 }}</text>

      <!-- link -->
      <line x1="236" y1="210" x2="324" y2="210" class="arch__line" marker-start="url(#arrow)" marker-end="url(#arrow)" />
      <text x="280" y="196" text-anchor="middle" class="arch__small">{{ t("link.top") }}</text>
      <text x="280" y="232" text-anchor="middle" class="arch__small">{{ t("link.bottom") }}</text>

      <!-- Agent server -->
      <rect x="330" y="30" width="330" height="360" rx="12" class="arch__box arch__box--core" />
      <text x="352" y="62" class="arch__eyebrow">{{ t("server.eyebrow") }}</text>
      <text x="352" y="92" class="arch__title">{{ t("server.title") }}</text>
      <g class="arch__rows">
        <rect x="352" y="112" width="286" height="40" rx="7" class="arch__row arch__row--loop" />
        <text x="368" y="137" class="arch__text arch__text--strong">{{ t("server.loop") }}</text>
        <text x="622" y="137" text-anchor="end" class="arch__small">{{ t("server.license") }}</text>
        <rect x="352" y="160" width="286" height="40" rx="7" class="arch__row" />
        <text x="368" y="185" class="arch__text">{{ t("server.hooks") }}</text>
        <rect x="352" y="208" width="286" height="40" rx="7" class="arch__row" />
        <text x="368" y="233" class="arch__text">{{ t("server.subagents") }}</text>
        <rect x="352" y="256" width="286" height="40" rx="7" class="arch__row" />
        <text x="368" y="281" class="arch__text">{{ t("server.schedules") }}</text>
        <rect x="352" y="304" width="286" height="40" rx="7" class="arch__row" />
        <text x="368" y="329" class="arch__text">{{ t("server.sessions") }}</text>
      </g>
      <text x="352" y="372" class="arch__small">{{ t("server.where") }}</text>

      <!-- outputs -->
      <line x1="666" y1="120" x2="744" y2="78" class="arch__line" marker-end="url(#arrow)" />
      <line x1="666" y1="210" x2="744" y2="210" class="arch__line" marker-end="url(#arrow)" />
      <line x1="666" y1="300" x2="744" y2="342" class="arch__line" marker-end="url(#arrow)" />

      <rect x="750" y="22" width="220" height="112" rx="12" class="arch__box" />
      <text x="770" y="52" class="arch__eyebrow">{{ t("systems.eyebrow") }}</text>
      <text x="770" y="80" class="arch__title arch__title--sm">{{ t("systems.title") }}</text>
      <text x="770" y="104" class="arch__text">{{ t("systems.text") }}</text>

      <rect x="750" y="154" width="220" height="112" rx="12" class="arch__box" />
      <text x="770" y="184" class="arch__eyebrow">{{ t("integrations.eyebrow") }}</text>
      <text x="770" y="212" class="arch__title arch__title--sm">{{ t("integrations.title") }}</text>
      <text x="770" y="236" class="arch__text">{{ t("integrations.text") }}</text>

      <rect x="750" y="286" width="220" height="112" rx="12" class="arch__box" />
      <text x="770" y="316" class="arch__eyebrow">{{ t("models.eyebrow") }}</text>
      <text x="770" y="344" class="arch__title arch__title--sm">{{ t("models.title") }}</text>
      <text x="770" y="368" class="arch__text">{{ t("models.text") }}</text>
    </svg>
  </div>
</template>

<style scoped>
.arch {
  overflow-x: auto;
  border: 1.5px solid var(--ink);
  border-radius: 12px;
  background: var(--paper-raised);
  padding: 18px;
}
svg {
  display: block;
  width: 100%;
  min-width: 720px;
  height: auto;
  font-family: var(--font-body);
}
.arch__box {
  fill: var(--paper);
  stroke: var(--ink);
  stroke-width: 1.5;
}
.arch__box--core {
  fill: var(--signal-soft);
  stroke: var(--signal);
}
.arch__row {
  fill: var(--paper-raised);
  stroke: var(--rule-strong);
}
.arch__row--loop {
  stroke: var(--signal);
  stroke-width: 1.5;
}
.arch__line {
  stroke: var(--ink-soft);
  stroke-width: 1.5;
  fill: none;
}
.arch__arrowhead {
  fill: var(--ink-soft);
}
.arch__eyebrow {
  fill: var(--ink-faint);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
}
.arch__title {
  fill: var(--ink);
  font-family: var(--font-display);
  font-stretch: 115%;
  font-weight: 760;
  font-size: 21px;
}
.arch__title--sm {
  font-size: 18px;
}
.arch__text {
  fill: var(--ink-soft);
  font-size: 14px;
}
.arch__text--strong {
  fill: var(--ink);
  font-weight: 600;
}
.arch__small {
  fill: var(--ink-faint);
  font-family: var(--font-mono);
  font-size: 11px;
}
</style>
