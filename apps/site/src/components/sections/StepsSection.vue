<script setup lang="ts">
import type { Section } from "../../cms.ts";
import CodeBlock from "../CodeBlock.vue";

defineProps<{ section: Extract<Section, { type: "steps" }> }>();
</script>

<template>
  <ol class="steps">
    <li v-for="(step, i) in section.items" :id="step.key && `step-${step.key}`" :key="step.key ?? i" class="ledger step">
      <div class="ledger__margin step__margin">
        <span class="step__num">{{ String(i + 1).padStart(2, "0") }}</span>
        <span v-if="step.duration" class="label">{{ step.duration }}</span>
      </div>
      <div class="ledger__body step__body" :class="{ 'step__body--code': step.code.length }">
        <div class="step__text">
          <h3>{{ step.title }}</h3>
          <p v-if="step.bodyHtml" v-html="step.bodyHtml" />
          <ul v-if="step.points.length" class="step__points">
            <li v-for="point in step.points" :key="point">{{ point }}</li>
          </ul>
          <p v-if="step.outcome" class="step__deliverable"><span class="label">{{ section.outcomeLabel }}</span> {{ step.outcome }}</p>
        </div>
        <CodeBlock v-if="step.code.length" :files="step.code" />
      </div>
    </li>
  </ol>
</template>
