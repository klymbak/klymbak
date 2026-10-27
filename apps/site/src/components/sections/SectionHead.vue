<script setup lang="ts">
import type { Section } from "../../cms.ts";

defineProps<{ section: Section; titleId: string }>();
</script>

<template>
  <div class="section__head">
    <p class="label">{{ section.eyebrow }}</p>
    <div>
      <h2 v-if="section.heading" :id="titleId">{{ section.heading }}</h2>
      <p v-if="section.ledeHtml" class="section__lede" v-html="section.ledeHtml" />
    </div>
  </div>
</template>
