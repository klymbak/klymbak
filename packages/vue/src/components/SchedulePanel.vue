<script setup lang="ts">
import { computed, ref } from "vue";
import type { ScheduleInfo } from "@klymbak/protocol";
import { useAgentStore, useI18n } from "../context";
import KlIcon from "./KlIcon.vue";

const emit = defineEmits<{ openSession: [id: string] }>();
const store = useAgentStore();
const i18n = useI18n();

/** Offered in the form, each described in words by describeCron. */
const PRESETS = ["0 8 * * 1-5", "0 9 * * 1", "0 18 * * *", "0 * * * *", "0 9 1 * *"];

const creating = ref(false);
const form = ref({ name: "", cron: PRESETS[0]!, custom: "", prompt: "", agent: "" });
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
    form.value = { name: "", cron: PRESETS[0]!, custom: "", prompt: "", agent: "" };
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
    <p class="kl-schedules__intro">{{ i18n.t("schedules.intro") }}</p>

    <article v-for="schedule in schedules" :key="schedule.id" class="kl-schedule" :class="{ 'kl-schedule--paused': !schedule.enabled }">
      <div class="kl-schedule__top">
        <span class="kl-schedule__name">{{ schedule.name }}</span>
        <label v-if="canManage(schedule)" class="kl-switch" :title="i18n.t(schedule.enabled ? 'schedules.pause' : 'schedules.resume')">
          <input type="checkbox" :checked="schedule.enabled" @change="store.updateSchedule(schedule.id, { enabled: !schedule.enabled })" />
          <span class="kl-switch__track" />
          <span class="kl-sr-only">{{ i18n.t(schedule.enabled ? "schedules.active" : "schedules.paused") }}</span>
        </label>
      </div>
      <div class="kl-schedule__when">
        <KlIcon name="clock" :size="12" />
        {{ i18n.describeCron(schedule.cron) }}
        <span v-if="schedule.agent" class="kl-pill">{{ schedule.agent }}</span>
        <span v-if="schedule.source !== 'config'" class="kl-pill kl-tone-info">
          {{ i18n.t(schedule.source === "agent" ? "schedules.madeInChat" : "schedules.yours") }}
        </span>
      </div>
      <p class="kl-schedule__prompt">{{ schedule.prompt }}</p>
      <div class="kl-schedule__foot">
        <span v-if="schedule.running" class="kl-schedule__running"><span class="kl-spinner" /> {{ i18n.t("schedules.runningNow") }}</span>
        <span v-else-if="schedule.enabled && schedule.nextRunAt" class="kl-faint">{{ i18n.t("schedules.next", { when: i18n.timeAgo(schedule.nextRunAt) }) }}</span>
        <span v-else class="kl-faint">{{ i18n.t("schedules.paused") }}</span>
        <button v-if="schedule.lastRun?.sessionId" type="button" class="kl-schedule__last" @click="openResult(schedule)">
          <span class="kl-pill" :class="`kl-tone-${statusTone[schedule.lastRun.status]}`">{{ i18n.t(`schedules.status.${schedule.lastRun.status}`) }}</span>
          {{ i18n.timeAgo(schedule.lastRun.at) }}
        </button>
      </div>
      <div class="kl-schedule__actions">
        <button type="button" class="kl-btn kl-btn--sm" :disabled="schedule.running" @click="store.runSchedule(schedule.id)">
          <KlIcon name="play" :size="12" /> {{ i18n.t("schedules.runNow") }}
        </button>
        <button
          v-if="schedule.source !== 'config' && canManage(schedule)"
          type="button"
          class="kl-btn kl-btn--sm kl-btn--ghost kl-btn--danger"
          @click="store.deleteSchedule(schedule.id)"
        >
          {{ i18n.t("common.delete") }}
        </button>
      </div>
    </article>

    <p v-if="!schedules.length" class="kl-faint">{{ i18n.t("schedules.empty") }}</p>

    <button v-if="!creating" type="button" class="kl-btn" @click="creating = true"><KlIcon name="plus" :size="14" /> {{ i18n.t("schedules.new") }}</button>
    <form v-else class="kl-schedule-form" @submit.prevent="create">
      <label class="kl-label">
        {{ i18n.t("schedules.name") }} <input v-model="form.name" class="kl-input" required :placeholder="i18n.t('schedules.namePlaceholder')" />
      </label>
      <label class="kl-label">
        {{ i18n.t("schedules.when") }}
        <select v-model="form.cron" class="kl-select">
          <option v-for="cron in PRESETS" :key="cron" :value="cron">{{ i18n.describeCron(cron) }}</option>
          <option value="custom">{{ i18n.t("schedules.custom") }}</option>
        </select>
      </label>
      <label v-if="form.cron === 'custom'" class="kl-label">
        {{ i18n.t("schedules.cron") }}
        <input v-model="form.custom" class="kl-input kl-code" placeholder="30 7 * * 1-5" />
      </label>
      <label v-if="agents.length" class="kl-label">
        {{ i18n.t("schedules.runAs") }}
        <select v-model="form.agent" class="kl-select">
          <option value="">{{ i18n.t("schedules.mainAgent") }}</option>
          <option v-for="agent in agents" :key="agent.name" :value="agent.name">{{ agent.name }}</option>
        </select>
      </label>
      <label class="kl-label">
        {{ i18n.t("schedules.prompt") }}
        <textarea v-model="form.prompt" class="kl-textarea" rows="3" required :placeholder="i18n.t('schedules.promptPlaceholder')" />
      </label>
      <div class="kl-schedule__actions">
        <button type="submit" class="kl-btn kl-btn--primary kl-btn--sm" :disabled="saving">{{ i18n.t("schedules.create") }}</button>
        <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" @click="creating = false">{{ i18n.t("common.cancel") }}</button>
      </div>
    </form>
  </div>
</template>
