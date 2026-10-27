<script setup lang="ts">
import { ref } from "vue";
import type { Section } from "../../cms.ts";
import { buttonClass, demoUrl, site, text } from "../../content.ts";
import SiteLink from "../SiteLink.vue";

defineProps<{ section: Extract<Section, { type: "cta" }> }>();

const copiedEmail = ref(false);

async function copyEmail() {
  try {
    await navigator.clipboard.writeText(site.contactEmail!);
    copiedEmail.value = true;
    setTimeout(() => (copiedEmail.value = false), 1500);
  } catch {
    // Clipboard refused; the address is selectable text.
  }
}
</script>

<template>
  <section :id="section.anchor" class="cta">
    <div class="wrap cta__inner">
      <h2>{{ section.heading }}</h2>
      <p v-if="section.ledeHtml" v-html="section.ledeHtml" />
      <div v-if="section.actions.length || demoUrl" class="hero__ctas">
        <SiteLink v-for="action in section.actions" :key="action.url" :link="action" :class="[buttonClass(action), { cta__ghost: action.variant !== 'primary' }]" />
        <a v-if="demoUrl" class="btn btn--ghost cta__ghost" :href="demoUrl" target="_blank" rel="noopener">{{ text("common", "demo.open") }}</a>
      </div>
      <p v-if="site.contactEmail" class="cta__email">
        {{ text("common", "email.or") }} <a class="cta__address" :href="`mailto:${site.contactEmail}`">{{ site.contactEmail }}</a>
        <button type="button" @click="copyEmail">{{ copiedEmail ? text("common", "email.copied") : text("common", "email.copy") }}</button>
      </p>
    </div>
  </section>
</template>
