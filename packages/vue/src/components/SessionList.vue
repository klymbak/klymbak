<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { SessionSummary } from "@klymbak/protocol";
import { useAgentStore, useI18n } from "../context";
import KlIcon from "./KlIcon.vue";

const emit = defineEmits<{ open: [id: string] }>();
const store = useAgentStore();
const i18n = useI18n();

const query = ref("");
const renaming = ref<string | null>(null);
const draft = ref("");
const confirming = ref<string | null>(null);
const renameInput = ref<HTMLInputElement[]>();

const groups = computed(() => {
  const q = query.value.trim().toLowerCase();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();
  const buckets: { label: string; items: SessionSummary[] }[] = [
    { label: i18n.t("sessions.today"), items: [] },
    { label: i18n.t("sessions.yesterday"), items: [] },
    { label: i18n.t("sessions.previous7Days"), items: [] },
    { label: i18n.t("sessions.older"), items: [] },
  ];
  for (const session of store.state.sessions) {
    if (q && !`${session.title} ${session.preview ?? ""}`.toLowerCase().includes(q)) continue;
    const t = session.updatedAt;
    const bucket = t >= today ? 0 : t >= today - 86_400_000 ? 1 : t >= today - 7 * 86_400_000 ? 2 : 3;
    buckets[bucket]!.items.push(session);
  }
  return buckets.filter((b) => b.items.length);
});

function open(id: string) {
  if (renaming.value) return;
  void store.openSession(id);
  emit("open", id);
}

async function startRename(session: SessionSummary) {
  renaming.value = session.id;
  draft.value = session.title;
  await nextTick();
  renameInput.value?.[0]?.select();
}

function commitRename() {
  const id = renaming.value;
  renaming.value = null;
  if (id && draft.value.trim()) void store.renameSession(id, draft.value.trim());
}
</script>

<template>
  <div class="kl-sessions">
    <button type="button" class="kl-btn kl-sessions__new" @click="store.newSession(); emit('open', '')">
      <KlIcon name="plus" :size="14" /> {{ i18n.t("sessions.new") }}
    </button>
    <input
      v-if="store.state.sessions.length > 8"
      v-model="query"
      class="kl-input"
      type="search"
      :placeholder="i18n.t('sessions.search')"
      :aria-label="i18n.t('sessions.search')"
    />
    <p v-if="!store.state.sessions.length" class="kl-sessions__empty">{{ i18n.t("sessions.empty") }}</p>
    <nav v-for="group in groups" :key="group.label" class="kl-sessions__group" :aria-label="group.label">
      <span class="kl-sessions__label">{{ group.label }}</span>
      <div
        v-for="session in group.items"
        :key="session.id"
        class="kl-session"
        :class="{ 'kl-session--active': session.id === store.state.sessionId }"
      >
        <input
          v-if="renaming === session.id"
          ref="renameInput"
          v-model="draft"
          class="kl-input kl-session__rename"
          :aria-label="i18n.t('sessions.titleLabel')"
          @keydown.enter="commitRename"
          @keydown.escape="renaming = null"
          @blur="commitRename"
        />
        <button v-else type="button" class="kl-session__open" :title="session.title" @click="open(session.id)">
          <span v-if="session.running" class="kl-spinner kl-session__icon" />
          <KlIcon v-else-if="session.source === 'schedule'" class="kl-session__icon" name="clock" :size="13" />
          <span class="kl-session__title">{{ session.title }}</span>
          <span v-if="session.unread" class="kl-session__unread" :aria-label="i18n.t('sessions.unread')" />
        </button>
        <span v-if="confirming === session.id" class="kl-session__confirm">
          <button type="button" class="kl-btn kl-btn--sm kl-btn--danger" @click="store.deleteSession(session.id); confirming = null">
            {{ i18n.t("common.delete") }}
          </button>
          <button type="button" class="kl-btn kl-btn--sm kl-btn--ghost" @click="confirming = null">{{ i18n.t("sessions.keep") }}</button>
        </span>
        <span v-else-if="renaming !== session.id" class="kl-session__tools">
          <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" :aria-label="i18n.t('sessions.rename')" @click="startRename(session)">
            <KlIcon name="edit" :size="13" />
          </button>
          <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" :aria-label="i18n.t('common.delete')" @click="confirming = session.id">
            <KlIcon name="trash" :size="13" />
          </button>
        </span>
      </div>
    </nav>
  </div>
</template>
