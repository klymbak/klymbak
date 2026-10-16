<script setup lang="ts">
import { computed, ref } from "vue";
import type { ScheduleInfo } from "@klymbak/protocol";
import { useAgentStore } from "../context";
import { describeCron, timeAgo } from "@klymbak/client";
import KlIcon from "./KlIcon.vue";

const emit = defineEmits<{ openSession: [id: string] }>();
const store = useAgentStore();

const PRESETS = [
  { label: "Every weekday at 08:00", cron: "0 8 * * 1-5" },
  { label: "Every Monday at 09:00", cron: "0 9 * * 1" },
  { label: "Every day at 18:00", cron: "0 18 * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "First day of the month at 09:00", cron: "0 9 1 * *" },
];

const creating = ref(false);
const form = ref({ name: "", cron: PRESETS[0]!.cron, custom: "", prompt: "", agent: "" });
const saving = ref(false);
const schedules = computed(() => store.state.schedules);
const agents = computed(() => store.state.config?.subagents ?? []);

const statusTone = { completed: "success", error: "danger", aborted: "neutral" } as const;

function canManage(schedule: ScheduleInfo) {
  const user = store.state.config?.user;
  return Boolean(user && (schedule.ownerId === user.id || user.roles.includes("admin")));
}

async function create() {
  const cron = form.value.cron === "custom" ? form.value.custom.trim() : form.value.cron;
  if (!form.value.name.trim() || !form.value.prompt.trim() || !cron) return;
  saving.value = true;
  try {
    await store.createSchedule({ name: form.value.name, prompt: form.value.prompt, cron, agent: form.value.agent || undefined });
    creating.value = false;
    form.value = { name: "", cron: PRESETS[0]!.cron, custom: "", prompt: "", agent: "" };
  } catch {
    // The store already shows the error.
  } finally {
    saving.value = false;
  }
}

function openResult(schedule: ScheduleInfo) {
  if (!schedule.lastRun?.sessionId) return;
  void store.openSession(schedule.lastRun.sessionId);
  emit("openSession", schedule.lastRun.sessionId);
}
</script>

<template>
  <div class="kl-schedules">
    <p class="kl-schedules__intro">The agent runs these on its own and notifies you when results are ready. You can also ask in chat: “every Monday at 9, summarize refunds”.</p>

    <article v-for="schedule in schedules" :key="schedule.id" class="kl-schedule" :class="{ 'kl-schedule--paused': !schedule.enabled }">
      <div class="kl-schedule__top">
        <span class="kl-schedule__name">{{ schedule.name }}</span>
        <label v-if="canManage(schedule)" class="kl-switch" :title="schedule.enabled ? 'Pause' : 'Resume'">
          <input type="checkbox" :checked="schedule.enabled" @change="store.updateSchedule(schedule.id, { enabled: !schedule.enabled })" />
          <span class="kl-switch__track" />
          <span class="kl-sr-only">{{ schedule.enabled ? "Active" : "Paused" }}</span>
        </label>
      </div>
      <div class="kl-schedule__when">
        <KlIcon name="clock" :size="12" />
        {{ describeCron(schedule.cron) }}
        <span v-if="schedule.agent" class="kl-pill">{{ schedule.agent }}</span>
        <span v-if="schedule.source !== 'config'" class="kl-pill kl-tone-info">{{ schedule.source === "agent" ? "made in chat" : "yours" }}</span>
      </div>
      <p class="kl-schedule__prompt">{{ schedule.prompt }}</p>
      <div class="kl-schedule__foot">
        <span v-if="schedule.running" class="kl-schedule__running"><span class="kl-spinner" /> Running now</span>
        <span v-else-if="schedule.enabled && schedule.nextRunAt" class="kl-faint">Next {{ timeAgo(schedule.nextRunAt) }}</span>
        <span v-else class="kl-faint">Paused</span>
        <button v-if="schedule.lastRun?.sessionId" type="button" class="kl-schedule__last" @click="openResult(schedule)">
          <span class="kl-pill" :class="`kl-tone-${statusTone[schedule.lastRun.status]}`">{{ schedule.lastRun.status }}</span>
          {{ timeAgo(schedule.lastRun.at) }}
        </button>
      </div>
      <div class="kl-schedule__actions">
        <button type="button" class="kl-btn kl-btn--sm" :disabled="schedule.running" @click="store.runSchedule(schedule.id)">
          <KlIcon name="play" :size="12" /> Run now
        </button>
        <button
          v-if="schedule.source !== 'config' && canManage(schedule)"
          type="button"
          class="kl-btn kl-btn--sm kl-btn--ghost kl-btn--danger"
          @click="store.deleteSchedule(schedule.id)"
        >
          Delete
        </button>
      </div>
    </article>

    <p v-if="!schedules.length" class="kl-faint">No scheduled tasks yet.</p>

    <button v-if="!creating" type="button" class="kl-btn" @click="creating = true"><KlIcon name="plus" :size="14" /> New scheduled task</button>
    <form v-else class="kl-schedule-form" @submit.prevent="create">
      <label class="kl-label">Name <input v-model="form.name" class="kl-input" required placeholder="Weekly refund summary" /></label>
      <label class="kl-label">
        When
        <select v-model="form.cron" class="kl-select">
          <option v-for="preset in PRESETS" :key="preset.cron" :value="preset.cron">{{ preset.label }}</option>
          <option value="custom">Custom (cron)…</option>
        </select>
      </label>
      <label v-if="form.cron === 'custom'" class="kl-label">
        Cron expression
        <input v-model="form.custom" class="kl-input kl-code" placeholder="30 7 * * 1-5" />
      </label>
      <label v-if="agents.length" class="kl-label">
        Run as
        <select v-model="form.agent" class="kl-select">
          <option value="">Main agent</option>
          <option v-for="agent in agents" :key="agent.name" :value="agent.name">{{ agent.name }}</option>
        </select>
      </label>
      <label class="kl-label">
        What should it do?
        <textarea v-model="form.prompt" class="kl-textarea" rows="3" required placeholder="Summarize last week's refunds by reason and flag anything unusual." />
      </label>
      <div class="kl-schedule__actions">
        <button type="submit" class="kl-btn kl-btn--primary kl-btn--sm" :disabled="saving">Create</button>
        <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" @click="creating = false">Cancel</button>
      </div>
    </form>
  </div>
</template>
