<script setup lang="ts">
import type { Link } from "../cms.ts";
import { href } from "../content.ts";

/** A link from the CMS. The slot replaces the label. */
defineProps<{ link: Link }>();
</script>

<template>
  <a :href="href(link.url)" :target="link.newTab ? '_blank' : undefined" :rel="link.newTab ? 'noopener' : undefined"><slot>{{ link.label }}</slot></a>
</template>
