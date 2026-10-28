<script setup lang="ts">
import type { Section } from "../../cms.ts";
import { lines, text } from "../../content.ts";
import StrapiSketch from "../StrapiSketch.vue";

/** `nested`: the section continues the one above, so its heading is a subheading. */
defineProps<{ section: Extract<Section, { type: "cards" }>; nested: boolean }>();

const sketches = ["page", "panel", "bulk"] as const;
const sketch = (key?: string) => sketches.find((view) => view === key);

// The before/after columns: the old admin panel's menu, with the screens one complaint needs lit up.
const legacyScreens = lines(text("before-after", "screens"));
const litScreens = [1, 2, 3, 5, 9];
</script>

<template>
  <div v-if="section.layout === 'columns'" class="ba">
    <div v-for="(item, i) in section.items" :key="item.key ?? i" class="ba__side" :class="item.key && `ba__side--${item.key}`">
      <p class="label">{{ item.label }}</p>
      <template v-if="item.key === 'before'">
        <div class="legacy" aria-hidden="true">
          <ul class="legacy__menu">
            <li v-for="(screen, n) in legacyScreens" :key="screen" :class="{ on: litScreens.includes(n) }">{{ screen }}</li>
          </ul>
          <div class="legacy__page">
            <div class="legacy__filters"><span /><span /><span /><span /></div>
            <div v-for="n in 7" :key="n" class="legacy__row"><span /><span /><span /><span /></div>
          </div>
        </div>
        <ol class="ba__list">
          <li v-for="point in item.points" :key="point">{{ point }}</li>
        </ol>
      </template>
      <template v-else>
        <template v-if="item.key === 'after'">
          <div class="ask">
            <span class="ask__who">{{ text("before-after", "ask.who") }}</span>
            <p>{{ text("before-after", "ask.text") }}</p>
          </div>
          <div class="stamp-row">
            <span class="stamp">{{ text("before-after", "stamp") }}</span>
            <span>{{ text("before-after", "stamp.text") }} · <span class="faint">{{ text("before-after", "stamp.by") }}</span></span>
          </div>
        </template>
        <ul class="ba__checks">
          <li v-for="point in item.points" :key="point">{{ point }}</li>
        </ul>
      </template>
    </div>
  </div>

  <ol v-else-if="section.layout === 'grid'" class="places">
    <li v-for="(item, i) in section.items" :key="item.key ?? i" class="place">
      <StrapiSketch v-if="sketch(item.key)" :view="sketch(item.key)!" />
      <img v-else-if="item.image" :src="item.image.url" :alt="item.image.alt" :width="item.image.width" :height="item.image.height" />
      <span v-if="item.label" class="label">{{ item.label }}</span>
      <h3 v-if="item.title">{{ item.title }}</h3>
      <p v-if="item.textHtml" v-html="item.textHtml" />
    </li>
  </ol>

  <div v-else-if="section.layout === 'table'" class="caps">
    <table>
      <thead>
        <tr>
          <th scope="col">{{ text("common", "table.title") }}</th>
          <th scope="col">{{ text("common", "table.text") }}</th>
          <th scope="col">{{ text("common", "table.detail") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, i) in section.items" :key="item.title ?? i">
          <th scope="row">{{ item.title }}</th>
          <td v-html="item.textHtml" />
          <td><code v-if="item.detail">{{ item.detail }}</code></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div v-else-if="section.layout === 'list'" class="wont">
    <h3 v-if="nested && section.heading">{{ section.heading }}</h3>
    <div v-else />

    <dl>
      <div v-for="(item, i) in section.items" :key="item.title ?? i">
        <dt>{{ item.title }}</dt>
        <dd v-html="item.textHtml" />
      </div>
    </dl>
  </div>

  <ol v-else class="pilot">
    <li v-for="(item, i) in section.items" :key="item.title ?? i">
      <span v-if="item.label" class="label">{{ item.label }}</span>
      <h3>{{ item.title }}</h3>
      <p v-if="item.textHtml" v-html="item.textHtml" />
    </li>
  </ol>
</template>
