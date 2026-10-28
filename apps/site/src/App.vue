<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import logo from "../../../docs/brand/klymbak-logo.svg";
import type { Section } from "./cms.ts";
import LanguageMenu from "./components/LanguageMenu.vue";
import SiteLink from "./components/SiteLink.vue";
import CtaSection from "./components/sections/CtaSection.vue";
import HeroSection from "./components/sections/HeroSection.vue";
import SectionBody from "./components/sections/SectionBody.vue";
import SectionHead from "./components/sections/SectionHead.vue";
import { home, locales, site, text } from "./content.ts";

type Theme = "auto" | "light" | "dark";
const theme = ref<Theme>("auto");
const themeName = computed(() => text("common", `theme.${theme.value}`));

onMounted(() => {
  try {
    const saved = localStorage.getItem("klymbak:theme");
    if (saved === "light" || saved === "dark") theme.value = saved;
  } catch {
    // Storage blocked; follow the system theme.
  }
});

watch(theme, (value) => {
  if (value === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  try {
    localStorage.setItem("klymbak:theme", value);
  } catch {
    // Not persisted; that's fine.
  }
});

function cycleTheme() {
  theme.value = theme.value === "auto" ? "dark" : theme.value === "dark" ? "light" : "auto";
}

// A section without an eyebrow continues the one above it, in the same <section>: the Strapi plugin's
// details follow its three places, “What it won't do” follows the capabilities. The hero and the
// closing call to action stand alone.
const alone = (section: Section) => section.type === "hero" || section.type === "cta";
const groups: { lead: Section; sections: Section[] }[] = [];
for (const section of home.sections) {
  const last = groups.at(-1);
  if (last && !section.eyebrow && !alone(section) && !alone(last.lead)) last.sections.push(section);
  else groups.push({ lead: section, sections: [section] });
}
const titleId = (lead: Section, index: number) => `${lead.anchor ?? `section-${index + 1}`}-title`;

/** What the header button adds to its short label on wide screens: “I want this” + “ in my admin panel”. */
const more = (label: string, short?: string) => (short && label.startsWith(short) && label !== short ? label.slice(short.length).trimStart() : undefined);
</script>

<template>
  <header class="top">
    <div class="wrap top__inner">
      <a class="brand" href="#top" :aria-label="text('common', 'brand.home')">
        <img :src="site.logo?.url ?? logo" width="30" height="30" alt="" />
        <span class="brand__text">
          <span class="brand__name">{{ site.name }}</span>
          <span v-if="site.tagline" class="brand__note">{{ site.tagline }}</span>
        </span>
      </a>
      <nav v-if="site.navigation.length" class="top__nav" :aria-label="text('common', 'nav.label')">
        <SiteLink v-for="item in site.navigation" :key="item.url" :link="item" />
      </nav>
      <LanguageMenu v-if="locales.length > 1" class="top__lang" />
      <button
        type="button"
        class="top__theme"
        :aria-label="text('common', 'theme.button', { theme: themeName })"
        :title="text('common', 'theme.title', { theme: themeName })"
        @click="cycleTheme"
      >
        <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
        <svg v-else-if="theme === 'light'" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        <svg v-else viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" /></svg>
      </button>
      <SiteLink v-for="action in site.actions" :key="action.url" :link="action" class="btn btn--primary top__cta">
        <template v-if="more(action.label, action.shortLabel)">{{ action.shortLabel }}<span class="top__cta-more">&nbsp;{{ more(action.label, action.shortLabel) }}</span></template>
      </SiteLink>
    </div>
  </header>

  <main id="top">
    <template v-for="(group, g) in groups" :key="g">
      <HeroSection v-if="group.lead.type === 'hero'" :section="group.lead" :theme="theme" />
      <CtaSection v-else-if="group.lead.type === 'cta'" :section="group.lead" />
      <section v-else :id="group.lead.anchor" class="section wrap" :aria-labelledby="group.lead.heading ? titleId(group.lead, g) : undefined">
        <SectionHead :section="group.lead" :title-id="titleId(group.lead, g)" />
        <SectionBody v-for="(section, i) in group.sections" :key="i" :section="section" :nested="i > 0" />
      </section>
    </template>
  </main>

  <footer class="foot wrap">
    <div v-if="site.footerHtml" class="foot__text" v-html="site.footerHtml" />
    <SiteLink v-for="item in site.footerLinks" :key="item.url" :link="item" />
  </footer>
</template>

<style>
/* Header ---------------------------------------------------------------------- */
.top {
  position: sticky;
  top: env(safe-area-inset-top, 0px);
  z-index: 20;
  background: color-mix(in srgb, var(--paper) 92%, transparent);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--rule);
}
.top__inner {
  display: flex;
  align-items: center;
  gap: 1.4rem;
  height: 62px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  text-decoration: none;
}
.brand img {
  flex: none;
  display: block;
}
.brand__text {
  display: grid;
  min-width: 0;
}
.brand__name {
  font-family: var(--font-display);
  font-stretch: 125%;
  font-weight: 800;
  font-size: 1.15rem;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
.brand__note {
  font-size: 0.74rem;
  line-height: 1.3;
  color: var(--ink-faint);
  white-space: nowrap;
}
.top__nav {
  display: flex;
  gap: 1.3rem;
  margin-left: auto;
  font-size: 0.92rem;
}
.top__nav a {
  text-decoration: none;
  color: var(--ink-soft);
}
.top__nav a:hover {
  color: var(--ink);
  text-decoration: underline;
}
.top__lang,
.top__theme {
  flex: none;
}
.top__theme {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border: 1px solid var(--rule-strong);
  border-radius: 8px;
  background: transparent;
  color: var(--ink);
  cursor: pointer;
}
.top__cta {
  flex: none;
  gap: 0;
  height: 38px;
  padding: 0 0.95rem;
  font-size: 0.9rem;
}

/* Hero ------------------------------------------------------------------------- */
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(0, 1fr);
  gap: clamp(2rem, 5vw, 4.5rem);
  align-items: center;
  padding-block: clamp(2.5rem, 6vw, 5rem);
}
.hero__copy {
  display: grid;
  gap: 1.4rem;
  align-content: center;
}
.hero h1 {
  font-size: clamp(2.4rem, 1.3rem + 3.6vw, 4.2rem);
  font-stretch: 112%;
  font-weight: 800;
  line-height: 0.98;
  letter-spacing: -0.025em;
}
.hero__lede {
  max-width: 34rem;
  font-size: 1.15rem;
  color: var(--ink-soft);
}
.hero__ctas {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.hero__facts {
  display: grid;
  gap: 0.35rem;
  margin: 0.4rem 0 0;
  padding: 1rem 0 0;
  list-style: none;
  border-top: 1px solid var(--rule);
  font-size: 0.92rem;
  color: var(--ink-soft);
}
.hero__facts strong {
  color: var(--ink);
  font-weight: 600;
}
.hero__demo {
  min-width: 0;
}

/* Before / after ------------------------------------------------------------------ */
.ba {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1.5px solid var(--ink);
  border-radius: 12px;
  overflow: hidden;
}
.ba__side {
  display: grid;
  gap: 1.1rem;
  align-content: start;
  padding: clamp(1.2rem, 3vw, 2rem);
  min-width: 0;
}
.ba__side--before {
  border-right: 1.5px solid var(--ink);
}
.ba__side--after {
  background: var(--paper-raised);
}
.legacy {
  display: grid;
  grid-template-columns: 9.5rem minmax(0, 1fr);
  height: 200px;
  border: 1px solid var(--rule-strong);
  border-radius: 8px;
  background: var(--paper-raised);
  overflow: hidden;
  font-size: 0.72rem;
}
.legacy__menu {
  margin: 0;
  padding: 0.5rem 0.4rem;
  list-style: none;
  border-right: 1px solid var(--rule);
  color: var(--ink-faint);
  line-height: 1.55;
  overflow: hidden;
}
.legacy__menu li {
  padding: 0 0.4rem;
  border-radius: 4px;
}
.legacy__menu li.on {
  background: var(--highlighter);
  color: var(--highlighter-ink);
}
.legacy__page {
  display: grid;
  gap: 7px;
  align-content: start;
  padding: 0.7rem;
}
.legacy__filters,
.legacy__row {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 6px;
}
.legacy__filters span,
.legacy__row span {
  height: 10px;
  border-radius: 3px;
  background: var(--rule);
}
.legacy__filters span {
  height: 16px;
  background: transparent;
  border: 1px solid var(--rule-strong);
}
.ba__list,
.ba__checks,
.feature__points {
  margin: 0;
  padding-left: 1.2rem;
  display: grid;
  gap: 0.3rem;
  font-size: 0.95rem;
  color: var(--ink-soft);
}
/* Ruled like ledger paper: each step sits on its own line. */
.ba__list {
  gap: 0;
  line-height: 2rem;
  background: repeating-linear-gradient(180deg, transparent 0 calc(2rem - 1px), var(--rule) calc(2rem - 1px) 2rem);
}
.ba__checks,
.feature__points {
  list-style: none;
  padding: 0;
}
.ba__checks li::before,
.feature__points li::before {
  content: "✓";
  margin-right: 0.55rem;
  color: var(--stamp-green);
  font-weight: 700;
}
.ask {
  padding: 1rem 1.1rem;
  border-radius: 14px 14px 4px 14px;
  background: var(--signal-soft);
  font-size: 1.05rem;
}
.ask__who {
  display: block;
  margin-bottom: 0.25rem;
  font-family: var(--font-mono);
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
.stamp-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.9rem;
  font-size: 0.95rem;
}
.stamp {
  padding: 0.15rem 0.6rem;
  border: 2.5px solid var(--stamp-green);
  border-radius: 5px;
  color: var(--stamp-green);
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 0.8rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  transform: rotate(-5deg);
}
.faint {
  color: var(--ink-faint);
}

/* Steps ------------------------------------------------------------------------- */
.steps {
  margin: 0;
  padding: 0;
  list-style: none;
  border-bottom: 1px solid var(--rule);
}
.step__margin {
  display: grid;
  align-content: start;
  gap: 0.4rem;
}
.step__num {
  font-family: var(--font-display);
  font-stretch: 125%;
  font-weight: 800;
  font-size: 2.6rem;
  line-height: 1;
  color: var(--signal);
}
.step__body {
  display: grid;
  gap: 1.6rem;
}
.step__body--code {
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.25fr);
  align-items: start;
}
.step__text {
  display: grid;
  gap: 0.75rem;
  align-content: start;
}
.step__text h3 {
  font-size: var(--step-2);
  max-width: 24ch;
}
.step__text > p {
  max-width: 60ch;
  color: var(--ink-soft);
}
.step__points {
  margin: 0;
  padding-left: 1.15rem;
  display: grid;
  gap: 0.2rem;
  font-size: 0.96rem;
}
.step__deliverable {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.6rem;
  margin-top: 0.3rem;
  padding-top: 0.75rem;
  border-top: 1px dashed var(--rule-strong);
  font-weight: 600;
}

/* Cards and features ------------------------------------------------------------------ */
.places {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.place {
  display: grid;
  gap: 0.45rem;
  align-content: start;
}
.place .label {
  margin-top: 0.6rem;
}
.place h3 {
  font-size: var(--step-1);
}
.place p {
  color: var(--ink-soft);
  font-size: 0.96rem;
  max-width: 36ch;
}
.feature {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 1.6rem 2.4rem;
  align-items: start;
}
/* Continuing the section above, under a rule. */
.feature--continued {
  margin-top: 2.6rem;
  padding-top: 2.2rem;
  border-top: 1px solid var(--rule);
}
.feature__text {
  display: grid;
  gap: 1.2rem;
}
.feature__text h3 {
  font-size: var(--step-1);
}
.feature__points {
  gap: 0.55rem;
}
.feature__points li {
  display: flex;
}
.feature__links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.4rem;
  font-weight: 600;
  font-size: 0.95rem;
}
.feature__links a[target="_blank"]::after {
  content: " ↗";
  font-weight: 400;
  color: var(--ink-faint);
}
.section__subhead {
  margin: 3rem 0 1.4rem;
  font-size: var(--step-1);
}
.prose {
  max-width: 68ch;
  margin-left: var(--margin-col);
  color: var(--ink-soft);
}
.prose > * + * {
  margin-top: 1rem;
}

/* Capabilities ------------------------------------------------------------------------ */
.caps {
  overflow-x: auto;
  border: 1.5px solid var(--ink);
  border-radius: 12px;
  background: var(--paper-raised);
}
.caps table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.96rem;
}
.caps th,
.caps td {
  padding: 0.85rem 1.1rem;
  text-align: left;
  vertical-align: top;
  border-bottom: 1px solid var(--rule);
}
.caps thead th {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
  border-bottom: 1.5px solid var(--ink);
}
.caps tbody th {
  font-weight: 600;
  white-space: nowrap;
}
.caps tbody td:first-of-type {
  color: var(--ink-soft);
}
.caps tbody tr:last-child th,
.caps tbody tr:last-child td {
  border-bottom: 0;
}
.caps code {
  white-space: nowrap;
  color: var(--signal);
}
.wont {
  display: grid;
  grid-template-columns: var(--margin-col) minmax(0, 1fr);
  margin-top: 3rem;
}
.wont h3 {
  font-size: var(--step-1);
  padding-right: 1rem;
}
.wont dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: 1.2rem 2rem;
  margin: 0;
}
.wont dt {
  font-weight: 600;
  text-decoration: line-through;
  text-decoration-color: var(--stamp-red);
  text-decoration-thickness: 2px;
}
.wont dd {
  margin: 0.25rem 0 0;
  color: var(--ink-soft);
  font-size: 0.95rem;
}

/* Pilot ---------------------------------------------------------------------------- */
.pilot {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 3px solid var(--ink);
}
.pilot li {
  display: grid;
  gap: 0.5rem;
  align-content: start;
  padding: 1.3rem 1.5rem 0 0;
  position: relative;
}
.pilot li::before {
  content: "";
  position: absolute;
  top: -9px;
  left: 0;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: var(--paper);
  border: 3px solid var(--ink);
}
.pilot li:last-child::before {
  background: var(--signal);
  border-color: var(--signal);
}
.pilot h3 {
  font-size: var(--step-1);
}
.pilot p {
  color: var(--ink-soft);
  font-size: 0.96rem;
  max-width: 32ch;
}

/* FAQ -------------------------------------------------------------------------------- */
.faq {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  border-top: 1px solid var(--rule);
  margin-left: var(--margin-col);
}
.faq details {
  border-bottom: 1px solid var(--rule);
}
.faq summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1.05rem 0;
  font-weight: 600;
  font-size: 1.05rem;
  cursor: pointer;
  list-style: none;
}
.faq summary::-webkit-details-marker {
  display: none;
}
.faq summary::after {
  content: "+";
  font-family: var(--font-mono);
  font-size: 1.2rem;
  color: var(--ink-faint);
}
.faq details[open] summary::after {
  content: "–";
}
.faq details p {
  max-width: 65ch;
  padding: 0 0 1.2rem;
  color: var(--ink-soft);
}

/* CTA ------------------------------------------------------------------------------------ */
.cta {
  background: var(--ink);
  color: var(--paper);
  padding-block: clamp(3.5rem, 8vw, 6rem);
}
.cta__inner {
  display: grid;
  gap: 1.2rem;
  justify-items: start;
}
.cta h2 {
  font-size: var(--step-3);
  max-width: 20ch;
  font-stretch: 125%;
}
.cta p {
  max-width: 52ch;
  color: color-mix(in srgb, var(--paper) 78%, transparent);
}
.cta .btn--primary {
  background: var(--highlighter);
  border-color: var(--highlighter);
  color: var(--highlighter-ink);
}
.cta__ghost {
  border-color: var(--paper);
  color: var(--paper);
}
.cta__ghost:hover {
  background: var(--paper);
  color: var(--ink);
}
.cta__email {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
}
.cta__address {
  font-family: var(--font-mono);
  color: var(--paper);
}
.cta__email button {
  padding: 2px 10px;
  border: 1px solid color-mix(in srgb, var(--paper) 45%, transparent);
  border-radius: 6px;
  background: transparent;
  color: var(--paper);
  font: inherit;
  font-size: 0.82rem;
  cursor: pointer;
}

.foot {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 2rem;
  padding-block: 1.6rem calc(1.6rem + env(safe-area-inset-bottom, 0px));
  font-size: 0.86rem;
  color: var(--ink-faint);
}
.foot a {
  color: var(--ink-soft);
}
/* Each paragraph of the footer text is one item of the row. */
.foot__text {
  display: contents;
}

/* Responsive --------------------------------------------------------------------------- */
@media (max-width: 1120px) {
  .top__cta-more {
    display: none;
  }
}
@media (max-width: 1020px) {
  /* The menu would wrap here, sooner in languages with longer words; the button gets its full label back. */
  .top__nav {
    display: none;
  }
  .top__lang,
  .top__theme {
    margin-left: auto;
  }
  .top__lang + .top__theme {
    margin-left: 0;
  }
  .top__cta-more {
    display: inline;
  }
  .hero {
    grid-template-columns: minmax(0, 1fr);
  }
  .step__body--code,
  .feature {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 860px) {
  .places {
    grid-template-columns: minmax(0, 1fr);
    gap: 2rem;
  }
  .ba {
    grid-template-columns: minmax(0, 1fr);
  }
  .ba__side--before {
    border-right: 0;
    border-bottom: 1.5px solid var(--ink);
  }
  .wont {
    grid-template-columns: minmax(0, 1fr);
    gap: 1rem;
  }
  .pilot {
    grid-template-columns: minmax(0, 1fr);
    border-top: 0;
    border-left: 3px solid var(--ink);
    padding-left: 1.3rem;
    gap: 1.6rem;
  }
  .pilot li {
    padding: 0;
  }
  .pilot li::before {
    top: 0.3rem;
    left: calc(-1.3rem - 9px);
  }
  .faq {
    margin-left: 0;
  }
  .caps table,
  .caps thead,
  .caps tbody,
  .caps tr,
  .caps th,
  .caps td {
    display: block;
  }
  .caps thead {
    display: none;
  }
  .caps tr {
    padding: 0.9rem 1rem;
    border-bottom: 1px solid var(--rule);
  }
  .caps th,
  .caps td {
    padding: 0.15rem 0;
    border: 0;
  }
  .caps tbody th {
    white-space: normal;
  }
}
@media (max-width: 640px) {
  .top__inner {
    gap: 0.8rem;
  }
  .top__cta-more {
    display: none;
  }
}
@media (max-width: 480px) {
  .brand__note {
    display: none;
  }
}
/* The smallest phones: with a language menu in the header, the logo stands for the name. */
@media (max-width: 360px) {
  .top__inner:has(.top__lang) .brand__text {
    display: none;
  }
}
@media (max-width: 520px) {
  .legacy {
    grid-template-columns: 7rem minmax(0, 1fr);
  }
  .hero h1 {
    font-stretch: 110%;
  }
}
</style>
