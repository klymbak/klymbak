<script setup lang="ts">
import type { Section } from "../../cms.ts";
import { buttonClass, demoUrl, text } from "../../content.ts";
import HeroReplay from "../HeroReplay.vue";
import SiteLink from "../SiteLink.vue";

const props = defineProps<{ section: Extract<Section, { type: "hero" }>; theme: "auto" | "light" | "dark" }>();

// The highlight is written as it appears in the heading; mark its first occurrence.
const at = props.section.highlight ? props.section.heading.indexOf(props.section.highlight) : -1;
const heading =
  at < 0
    ? undefined
    : { before: props.section.heading.slice(0, at), mark: props.section.highlight!, after: props.section.heading.slice(at + props.section.highlight!.length) };

// “Pilot in three weeks” but “Any model: Claude…”: no space before punctuation.
const gap = (text: string) => (/^[,.:;!?)]/.test(text) ? "" : " ");
</script>

<template>
  <section :id="section.anchor" class="hero wrap">
    <div class="hero__copy">
      <p v-if="section.eyebrow" class="label">{{ section.eyebrow }}</p>
      <h1 v-if="heading">{{ heading.before }}<mark>{{ heading.mark }}</mark>{{ heading.after }}</h1>
      <h1 v-else>{{ section.heading }}</h1>
      <p v-if="section.ledeHtml" class="hero__lede" v-html="section.ledeHtml" />
      <div v-if="demoUrl || section.actions.length" class="hero__ctas">
        <a v-if="demoUrl" class="btn btn--primary" :href="demoUrl" target="_blank" rel="noopener">{{ text("common", "demo.open") }}</a>
        <SiteLink v-for="action in section.actions" :key="action.url" :link="action" :class="buttonClass(action, Boolean(demoUrl))" />
      </div>
      <ul v-if="section.facts.length" class="hero__facts">
        <li v-for="fact in section.facts" :key="fact.term"><strong>{{ fact.term }}</strong>{{ gap(fact.text) }}{{ fact.text }}</li>
      </ul>
    </div>
    <div class="hero__demo">
      <img v-if="section.image" :src="section.image.url" :alt="section.image.alt" :width="section.image.width" :height="section.image.height" />
      <HeroReplay v-else :theme="theme" />
    </div>
  </section>
</template>
