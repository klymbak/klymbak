<script setup lang="ts">
import type { Section } from "../../cms.ts";
import CodeBlock from "../CodeBlock.vue";
import SiteLink from "../SiteLink.vue";

/** `nested`: the section continues the one above, set off by a rule. */
defineProps<{ section: Extract<Section, { type: "feature" }>; nested: boolean }>();
</script>

<template>
  <div class="feature" :class="{ 'feature--continued': nested }">
    <div class="feature__text">
      <h3 v-if="nested && section.heading">{{ section.heading }}</h3>
      <p v-if="nested && section.ledeHtml" v-html="section.ledeHtml" />
      <ul v-if="section.points.length" class="feature__points">
        <li v-for="point in section.points" :key="point">{{ point }}</li>
      </ul>
      <p v-if="section.actions.length" class="feature__links">
        <SiteLink v-for="action in section.actions" :key="action.url" :link="action" />
      </p>
    </div>
    <CodeBlock v-if="section.code.length" :files="section.code" />
    <img v-else-if="section.image" :src="section.image.url" :alt="section.image.alt" :width="section.image.width" :height="section.image.height" />
  </div>
</template>
