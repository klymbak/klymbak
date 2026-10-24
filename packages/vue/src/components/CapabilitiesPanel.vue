<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolInfo } from "@klymbak/protocol";
import { useAgentStore, useI18n } from "../context";
import KlIcon from "./KlIcon.vue";

const store = useAgentStore();
const i18n = useI18n();
const config = computed(() => store.state.config);

const groups = computed(() => {
  const tools = config.value?.tools ?? [];
  const sections: { key: string; title: string; icon: string; tools: ToolInfo[] }[] = [
    { key: "local", title: i18n.t("caps.appActions"), icon: "tool", tools: tools.filter((t) => t.source === "local") },
    ...[...new Set(tools.filter((t) => t.source === "mcp").map((t) => t.server!))].map((server) => ({
      key: `mcp:${server}`,
      title: i18n.t("caps.mcpGroup", { server }),
      icon: "plug",
      tools: tools.filter((t) => t.source === "mcp" && t.server === server),
    })),
    { key: "builtin", title: i18n.t("caps.builtin"), icon: "clock", tools: tools.filter((t) => t.source === "builtin" || t.source === "subagent") },
  ];
  return sections.filter((s) => s.tools.length);
});

const intro = computed(() =>
  config.value
    ? i18n.parts("caps.intro", { name: config.value.user.name, roles: config.value.user.roles.join(", "), asksFirst: i18n.t("caps.asksFirst") })
    : [],
);

const form = ref({ name: "", url: "", token: "" });
const adding = ref(false);
const addError = ref("");

async function connect() {
  addError.value = "";
  adding.value = true;
  try {
    const headers = form.value.token ? { authorization: `Bearer ${form.value.token}` } : undefined;
    const server = await store.addMcpServer(form.value.name.trim(), form.value.url.trim(), headers);
    if (server.status === "error") addError.value = server.error ?? i18n.t("caps.connectFailed");
    else form.value = { name: "", url: "", token: "" };
  } catch (error) {
    addError.value = error instanceof Error ? error.message : i18n.t("caps.connectFailed");
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <div v-if="config" class="kl-caps">
    <p class="kl-caps__intro">
      <template v-for="(part, i) in intro" :key="i">
        <strong v-if="part.arg === 'name'">{{ part.text }}</strong>
        <span v-else-if="part.arg === 'roles'" class="kl-faint">{{ part.text }}</span>
        <span v-else-if="part.arg === 'asksFirst'" class="kl-pill kl-tone-warning">{{ part.text }}</span>
        <template v-else>{{ part.text }}</template>
      </template>
    </p>

    <section v-if="config.subagents.length" class="kl-caps__section">
      <h4><KlIcon name="agents" :size="14" /> {{ i18n.t("caps.specialists") }}</h4>
      <div v-for="agent in config.subagents" :key="agent.name" class="kl-cap">
        <div class="kl-cap__top"><span class="kl-cap__name" style="text-transform: capitalize">{{ agent.name }}</span></div>
        <p class="kl-cap__desc">{{ agent.description }}</p>
        <p class="kl-cap__tools kl-faint">{{ i18n.t("caps.toolCount", { count: agent.tools.length }) }}</p>
      </div>
    </section>

    <section v-if="config.skills.length" class="kl-caps__section">
      <h4><KlIcon name="file" :size="14" /> {{ i18n.t("caps.skills") }} <span class="kl-faint">{{ config.skills.length }}</span></h4>
      <div v-for="skill in config.skills" :key="skill.name" class="kl-cap">
        <div class="kl-cap__top"><span class="kl-cap__name">{{ skill.name }}</span></div>
        <p class="kl-cap__desc">{{ skill.description }}</p>
      </div>
    </section>

    <section v-for="group in groups" :key="group.key" class="kl-caps__section">
      <h4><KlIcon :name="group.icon" :size="14" /> {{ group.title }} <span class="kl-faint">{{ group.tools.length }}</span></h4>
      <div v-for="tool in group.tools" :key="tool.name" class="kl-cap">
        <div class="kl-cap__top">
          <span class="kl-cap__name">{{ tool.label }}</span>
          <span v-if="tool.approval !== 'never'" class="kl-pill kl-tone-warning">{{ i18n.t(tool.approval === "always" ? "caps.asksFirst" : "caps.mayAsk") }}</span>
          <span v-else-if="tool.readOnly" class="kl-pill">{{ i18n.t("caps.readOnly") }}</span>
        </div>
        <p class="kl-cap__desc">{{ tool.description }}</p>
      </div>
    </section>

    <section class="kl-caps__section">
      <h4><KlIcon name="plug" :size="14" /> {{ i18n.t("caps.integrations") }}</h4>
      <div v-for="server in config.mcpServers" :key="server.name" class="kl-mcp">
        <span class="kl-mcp__dot" :class="`kl-mcp__dot--${server.status}`" :title="i18n.t(`caps.status.${server.status}`)" />
        <div class="kl-mcp__body">
          <span class="kl-cap__name">{{ server.name }}</span>
          <span class="kl-faint">
            {{ server.transport }} · {{ i18n.t("caps.toolCount", { count: server.tools.length }) }} · {{ i18n.t(`caps.status.${server.status}`) }}
          </span>
          <span v-if="server.error" class="kl-mcp__error">{{ server.error }}</span>
        </div>
        <button v-if="server.runtime && config.features.runtimeMcp" type="button" class="kl-btn kl-btn--ghost kl-btn--sm" @click="store.removeMcpServer(server.name)">
          {{ i18n.t("caps.remove") }}
        </button>
      </div>
      <p v-if="!config.mcpServers.length" class="kl-faint">{{ i18n.t("caps.noServers") }}</p>

      <form v-if="config.features.runtimeMcp" class="kl-mcp-form" @submit.prevent="connect">
        <span class="kl-mcp-form__title">{{ i18n.t("caps.connectTitle") }}</span>
        <input
          v-model="form.name"
          class="kl-input"
          required
          pattern="[A-Za-z0-9_-]+"
          :placeholder="i18n.t('caps.serverNamePlaceholder')"
          :aria-label="i18n.t('caps.serverName')"
        />
        <input v-model="form.url" class="kl-input" required type="url" placeholder="https://mcp.example.com/mcp" :aria-label="i18n.t('caps.serverUrl')" />
        <input
          v-model="form.token"
          class="kl-input"
          type="password"
          :placeholder="i18n.t('caps.tokenPlaceholder')"
          :aria-label="i18n.t('caps.token')"
          autocomplete="off"
        />
        <p v-if="addError" class="kl-mcp__error">{{ addError }}</p>
        <button type="submit" class="kl-btn kl-btn--sm" :disabled="adding">
          <span v-if="adding" class="kl-spinner" /> {{ i18n.t("caps.connect") }}
        </button>
      </form>
    </section>
  </div>
</template>
