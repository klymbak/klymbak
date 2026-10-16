<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import { AgentWorkspace, createAgentClient, createAgentStore, type AgentStore, type UiAction } from "@klymbak/vue";
import ShipmentTimeline from "./components/ShipmentTimeline.vue";

interface DemoUser {
  key: string;
  name: string;
  title: string;
  roles: string[];
}

const SITE_URL = import.meta.env.VITE_SITE_URL ?? "http://localhost:5174";

const read = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice simply isn't remembered.
  }
};

const users = ref<DemoUser[]>([]);
const role = ref(read("acme:role", "admin"));
const theme = ref<"light" | "dark">(read("acme:theme", "light") === "dark" ? "dark" : "light");
const store = shallowRef<AgentStore>();

/**
 * In a real app the browser sends its session cookie and the server's `auth` hook
 * resolves the user. The demo fakes sign-in with a header so you can switch roles.
 */
function connect(as: string) {
  store.value?.dispose();
  store.value = createAgentStore({
    client: createAgentClient({ baseUrl: "/api/agent", headers: { "x-demo-user": as } }),
    persist: `acme:${as}`,
  });
}

watch(role, (value) => {
  write("acme:role", value);
  connect(value);
});
watch(theme, (value) => write("acme:theme", value));

onMounted(async () => {
  connect(role.value);
  try {
    users.value = await (await fetch("/api/demo/users")).json();
  } catch {
    users.value = [];
  }
});

const current = computed(() => users.value.find((u) => u.key === role.value));
const renderers = { tools: { carrier_track_shipment: ShipmentTimeline } };

function onAction(action: UiAction) {
  // UI blocks can ask the host app to act (open a record, deep-link...). The demo just logs it.
  console.info("[acme] action from the agent", action);
}
</script>

<template>
  <div class="acme" :data-theme="theme">
    <header class="acme-bar">
      <a class="acme-bar__brand" href="/" aria-label="Acme Outfitters back office">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
          <rect width="32" height="32" rx="8" fill="var(--acme-pine)" />
          <path d="M5 24l7.5-12 4.5 7 3-4.5L27 24z" fill="#f4f1e8" />
        </svg>
        <span>Acme Outfitters</span>
        <span class="acme-bar__tag">Back office</span>
      </a>
      <div class="acme-bar__spacer" />
      <label class="acme-bar__role">
        <span class="acme-bar__label">Signed in as</span>
        <select v-model="role" aria-label="Demo user">
          <option v-for="user in users" :key="user.key" :value="user.key">{{ user.name }} · {{ user.title }}</option>
        </select>
      </label>
      <button type="button" class="acme-bar__icon" :aria-label="theme === 'dark' ? 'Use light theme' : 'Use dark theme'" @click="theme = theme === 'dark' ? 'light' : 'dark'">
        <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
      </button>
      <a class="acme-bar__link" :href="SITE_URL" target="_blank" rel="noopener">How it works</a>
    </header>
    <p v-if="current && current.key !== 'admin'" class="acme-hint">
      {{ current.name }} has the <strong>{{ current.roles.join(", ") }}</strong> role:
      {{ current.key === "support" ? "refunds over $150 are blocked by policy, and admin-only tools are hidden." : "customer emails and phone numbers are masked in every result." }}
    </p>
    <div class="acme-main">
      <AgentWorkspace v-if="store" :key="role" :store="store" :theme="theme" :renderers="renderers" @action="onAction" />
    </div>
  </div>
</template>

<style>
.acme {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--acme-bar);
  color: var(--acme-bar-text);
}
.acme-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 52px;
  padding: max(6px, env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) 6px max(16px, env(safe-area-inset-left, 0px));
  border-bottom: 1px solid var(--acme-bar-border);
}
.acme-bar__brand {
  display: flex;
  align-items: center;
  gap: 9px;
  color: inherit;
  text-decoration: none;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.acme-bar__tag {
  padding: 2px 7px;
  border-radius: 5px;
  border: 1px solid var(--acme-bar-border);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  opacity: 0.8;
}
.acme-bar__spacer {
  flex: 1;
}
.acme-bar__role {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.acme-bar__label {
  font-size: 12px;
  opacity: 0.7;
  white-space: nowrap;
}
.acme-bar__role select {
  max-width: 260px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--acme-bar-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
}
.acme-bar__icon {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--acme-bar-border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.acme-bar__link {
  color: inherit;
  font-size: 13px;
  font-weight: 600;
  text-underline-offset: 3px;
  white-space: nowrap;
}
.acme-hint {
  margin: 0;
  padding: 6px max(16px, env(safe-area-inset-right, 0px)) 6px max(16px, env(safe-area-inset-left, 0px));
  font-size: 12.5px;
  background: color-mix(in srgb, var(--acme-pine) 10%, var(--acme-bar));
  border-bottom: 1px solid var(--acme-bar-border);
}
.acme-main {
  flex: 1;
  min-height: 0;
}
@media (max-width: 720px) {
  .acme-bar__tag,
  .acme-bar__label,
  .acme-bar__link {
    display: none;
  }
  .acme-bar__role select {
    max-width: 150px;
  }
}
</style>
