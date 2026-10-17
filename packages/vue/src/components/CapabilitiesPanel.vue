<script setup lang="ts">
import { computed, ref } from "vue";
import type { ToolInfo } from "@klymbak/protocol";
import { useAgentStore } from "../context";
import KlIcon from "./KlIcon.vue";

const store = useAgentStore();
const config = computed(() => store.state.config);

const groups = computed(() => {
  const tools = config.value?.tools ?? [];
  const sections: { key: string; title: string; icon: string; tools: ToolInfo[] }[] = [
    { key: "local", title: "App actions", icon: "tool", tools: tools.filter((t) => t.source === "local") },
    ...[...new Set(tools.filter((t) => t.source === "mcp").map((t) => t.server!))].map((server) => ({
      key: `mcp:${server}`,
      title: `${server} (MCP)`,
      icon: "plug",
      tools: tools.filter((t) => t.source === "mcp" && t.server === server),
    })),
    { key: "builtin", title: "Built-in", icon: "clock", tools: tools.filter((t) => t.source === "builtin" || t.source === "subagent") },
  ];
  return sections.filter((s) => s.tools.length);
});

const form = ref({ name: "", url: "", token: "" });
const adding = ref(false);
const addError = ref("");

async function connect() {
  addError.value = "";
  adding.value = true;
  try {
    const headers = form.value.token ? { authorization: `Bearer ${form.value.token}` } : undefined;
    const server = await store.addMcpServer(form.value.name.trim(), form.value.url.trim(), headers);
    if (server.status === "error") addError.value = server.error ?? "Couldn't connect.";
    else form.value = { name: "", url: "", token: "" };
  } catch (error) {
    addError.value = error instanceof Error ? error.message : "Couldn't connect.";
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <div v-if="config" class="kl-caps">
    <p class="kl-caps__intro">
      What the agent can do for <strong>{{ config.user.name }}</strong>&nbsp;<span class="kl-faint">({{ config.user.roles.join(", ") }})</span>. Actions marked <span class="kl-pill kl-tone-warning">asks first</span> wait for your approval.
    </p>

    <section v-if="config.subagents.length" class="kl-caps__section">
      <h4><KlIcon name="agents" :size="14" /> Specialists</h4>
      <div v-for="agent in config.subagents" :key="agent.name" class="kl-cap">
        <div class="kl-cap__top"><span class="kl-cap__name" style="text-transform: capitalize">{{ agent.name }}</span></div>
        <p class="kl-cap__desc">{{ agent.description }}</p>
        <p class="kl-cap__tools kl-faint">{{ agent.tools.length }} tools</p>
      </div>
    </section>

    <section v-if="config.skills.length" class="kl-caps__section">
      <h4><KlIcon name="file" :size="14" /> Skills <span class="kl-faint">{{ config.skills.length }}</span></h4>
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
          <span v-if="tool.approval !== 'never'" class="kl-pill kl-tone-warning">{{ tool.approval === "always" ? "asks first" : "may ask" }}</span>
          <span v-else-if="tool.readOnly" class="kl-pill">read-only</span>
        </div>
        <p class="kl-cap__desc">{{ tool.description }}</p>
      </div>
    </section>

    <section class="kl-caps__section">
      <h4><KlIcon name="plug" :size="14" /> Integrations</h4>
      <div v-for="server in config.mcpServers" :key="server.name" class="kl-mcp">
        <span class="kl-mcp__dot" :class="`kl-mcp__dot--${server.status}`" :title="server.status" />
        <div class="kl-mcp__body">
          <span class="kl-cap__name">{{ server.name }}</span>
          <span class="kl-faint">{{ server.transport }} · {{ server.tools.length }} tools · {{ server.status }}</span>
          <span v-if="server.error" class="kl-mcp__error">{{ server.error }}</span>
        </div>
        <button v-if="server.runtime && config.features.runtimeMcp" type="button" class="kl-btn kl-btn--ghost kl-btn--sm" @click="store.removeMcpServer(server.name)">
          Remove
        </button>
      </div>
      <p v-if="!config.mcpServers.length" class="kl-faint">No MCP servers connected.</p>

      <form v-if="config.features.runtimeMcp" class="kl-mcp-form" @submit.prevent="connect">
        <span class="kl-mcp-form__title">Connect an MCP server</span>
        <input v-model="form.name" class="kl-input" required pattern="[A-Za-z0-9_-]+" placeholder="Name, e.g. stripe" aria-label="Server name" />
        <input v-model="form.url" class="kl-input" required type="url" placeholder="https://mcp.example.com/mcp" aria-label="Server URL" />
        <input v-model="form.token" class="kl-input" type="password" placeholder="Bearer token (optional)" aria-label="Bearer token" autocomplete="off" />
        <p v-if="addError" class="kl-mcp__error">{{ addError }}</p>
        <button type="submit" class="kl-btn kl-btn--sm" :disabled="adding">
          <span v-if="adding" class="kl-spinner" /> Connect
        </button>
      </form>
    </section>
  </div>
</template>
