<script setup lang="ts">
import type { Section } from "../../cms.ts";
import ArchitectureDiagram from "../ArchitectureDiagram.vue";
import CardsSection from "./CardsSection.vue";
import FeatureSection from "./FeatureSection.vue";
import StepsSection from "./StepsSection.vue";

/** A section's content under its heading. `nested`: it continues the section above (see App.vue). */
defineProps<{ section: Section; nested: boolean }>();
</script>

<template>
  <CardsSection v-if="section.type === 'cards'" :section="section" :nested="nested" />
  <FeatureSection v-else-if="section.type === 'feature'" :section="section" :nested="nested" />
  <template v-else>
    <h3 v-if="nested && section.heading" class="section__subhead">{{ section.heading }}</h3>
    <StepsSection v-if="section.type === 'steps'" :section="section" />
    <div v-else-if="section.type === 'faq'" class="faq">
      <details v-for="item in section.items" :key="item.question">
        <summary>{{ item.question }}</summary>
        <div v-html="item.answerHtml" />
      </details>
    </div>
    <div v-else-if="section.type === 'rich-text'" class="prose" v-html="section.bodyHtml" />
    <!-- Custom sections are drawn here by name. -->
    <ArchitectureDiagram v-else-if="section.type === 'custom' && section.name === 'architecture-diagram'" />
  </template>
</template>
