<script setup lang="ts">
import type { UiBlock } from "@klymbak/protocol";
import { useRenderers } from "../../context";
import { toneClass } from "@klymbak/client";
import MarkdownContent from "../MarkdownContent.vue";
import KlIcon from "../KlIcon.vue";
import ActionBar from "./ActionBar.vue";
import ChartView from "./ChartView.vue";
import DataTable from "./DataTable.vue";
import KeyValueList from "./KeyValueList.vue";
import MediaGallery from "./MediaGallery.vue";
import SourceList from "./SourceList.vue";
import StatGrid from "./StatGrid.vue";

defineProps<{ block: UiBlock }>();
const renderers = useRenderers();
</script>

<template>
  <DataTable v-if="block.type === 'table'" :block="block" />
  <StatGrid v-else-if="block.type === 'stats'" :block="block" />
  <ChartView v-else-if="block.type === 'chart'" :block="block" />
  <KeyValueList v-else-if="block.type === 'keyvalue'" :block="block" />
  <MediaGallery v-else-if="block.type === 'media'" :block="block" />
  <SourceList v-else-if="block.type === 'sources'" :block="block" />
  <ActionBar v-else-if="block.type === 'actions'" :block="block" />
  <div v-else-if="block.type === 'markdown'" class="kl-block-md"><MarkdownContent :source="block.text" /></div>
  <div v-else-if="block.type === 'alert'" class="kl-alert" :class="toneClass(block.tone)" role="status">
    <KlIcon :name="block.tone === 'success' ? 'check' : block.tone === 'danger' || block.tone === 'warning' ? 'alert' : 'info'" :size="16" />
    <div>
      <strong v-if="block.title">{{ block.title }}</strong>
      <p>{{ block.text }}</p>
    </div>
  </div>
  <component :is="renderers.blocks[block.component]" v-else-if="block.type === 'custom' && renderers.blocks?.[block.component]" v-bind="block.props" />
  <pre v-else class="kl-block-raw">{{ JSON.stringify(block, null, 2) }}</pre>
</template>
