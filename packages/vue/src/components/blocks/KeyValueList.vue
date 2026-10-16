<script setup lang="ts">
import type { KeyValueBlock } from "@klymbak/protocol";
import { formatValue, toneClass } from "@klymbak/client";

defineProps<{ block: KeyValueBlock }>();
</script>

<template>
  <section class="kl-kv">
    <h4 v-if="block.title" class="kl-kv__title">{{ block.title }}</h4>
    <dl class="kl-kv__list">
      <div v-for="item in block.items" :key="item.label" class="kl-kv__row">
        <dt>{{ item.label }}</dt>
        <dd>
          <span v-if="item.format === 'badge'" class="kl-pill" :class="toneClass(item.tone)">{{ item.value }}</span>
          <span v-else-if="item.format === 'code'" class="kl-code">{{ item.value }}</span>
          <span v-else :class="item.tone ? ['kl-kv__toned', toneClass(item.tone)] : ''">{{ formatValue(item.value, item.format, item.currency) }}</span>
        </dd>
      </div>
    </dl>
  </section>
</template>
