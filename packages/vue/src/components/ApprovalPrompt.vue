<script setup lang="ts">
import { computed, ref } from "vue";
import type { ApprovalDecision, ApprovalView } from "@klymbak/protocol";
import { useI18n, useOptionalAgentStore } from "../context";
import KlIcon from "./KlIcon.vue";

const props = defineProps<{
  approval: ApprovalView;
  /** The conversation the approval belongs to, when it isn't the open one (the inbox's items). */
  sessionId?: string;
}>();
const emit = defineEmits<{ decide: [decision: ApprovalDecision] }>();
const store = useOptionalAgentStore();
const i18n = useI18n();

const remember = ref(false);
const reason = ref("");
const denying = ref(false);
const busy = ref(false);
/** What the person typed into the fields, by name. */
const drafts = ref<Record<string, string>>({});
const fields = computed(() => props.approval.fields ?? []);

const riskTone = { low: "info", medium: "warning", high: "danger" } as const;

async function decide(approved: boolean) {
  if (!approved && !denying.value) {
    denying.value = true;
    return;
  }
  busy.value = true;
  const edits: Record<string, string> = {};
  for (const field of fields.value) {
    const draft = drafts.value[field.name];
    if (draft !== undefined && draft !== field.value) edits[field.name] = draft;
  }
  const decision: ApprovalDecision = {
    approved,
    reason: reason.value.trim() || undefined,
    remember: approved && remember.value,
    ...(approved && Object.keys(edits).length ? { edits } : {}),
  };
  emit("decide", decision);
  try {
    await store?.decide(props.approval.id, decision, props.sessionId);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="kl-approval" :class="[`kl-approval--${approval.status}`, `kl-tone-${riskTone[approval.risk ?? 'medium']}`]">
    <template v-if="approval.status === 'pending'">
      <div class="kl-approval__head">
        <KlIcon name="shield" :size="15" />
        <span>{{ i18n.t("approval.needed") }}</span>
        <span v-if="approval.risk" class="kl-pill" :class="`kl-tone-${riskTone[approval.risk]}`">{{ i18n.t(`approval.risk.${approval.risk}`) }}</span>
      </div>
      <p class="kl-approval__title">{{ approval.title }}</p>
      <p v-if="approval.description" class="kl-approval__desc">{{ approval.description }}</p>
      <div v-if="fields.length" class="kl-approval__fields">
        <label v-for="field in fields" :key="field.name" class="kl-label">
          {{ field.label }}
          <textarea
            v-if="field.multiline"
            class="kl-textarea"
            rows="4"
            :value="drafts[field.name] ?? field.value"
            :disabled="busy"
            @input="drafts[field.name] = ($event.target as HTMLTextAreaElement).value"
          />
          <input
            v-else
            class="kl-input"
            type="text"
            :value="drafts[field.name] ?? field.value"
            :disabled="busy"
            @input="drafts[field.name] = ($event.target as HTMLInputElement).value"
          />
        </label>
      </div>
      <label v-if="denying" class="kl-label kl-approval__reason">
        {{ i18n.t("approval.reasonLabel") }}
        <input v-model="reason" class="kl-input" type="text" :placeholder="i18n.t('approval.reasonPlaceholder')" @keydown.enter="decide(false)" />
      </label>
      <div class="kl-approval__buttons">
        <button type="button" class="kl-btn kl-btn--primary" :disabled="busy" @click="decide(true)">
          <KlIcon name="check" :size="14" /> {{ i18n.t("approval.approve") }}
        </button>
        <button type="button" class="kl-btn" :disabled="busy" @click="decide(false)">
          <KlIcon name="x" :size="14" /> {{ i18n.t(denying ? "approval.confirmDeny" : "approval.deny") }}
        </button>
        <label v-if="approval.rememberable && !denying" class="kl-approval__remember">
          <input v-model="remember" type="checkbox" />
          {{ i18n.t("approval.remember") }}
        </label>
      </div>
    </template>
    <div v-else class="kl-approval__decided">
      <span class="kl-stamp" :class="`kl-stamp--${approval.status}`">{{ i18n.t(`approval.status.${approval.status}`) }}</span>
      <div class="kl-approval__summary">
        <span class="kl-approval__title">{{ approval.title }}</span>
        <span class="kl-faint">
          <template v-if="approval.decidedBy">{{ i18n.t("approval.decidedBy", { name: approval.decidedBy }) }}</template>
          <template v-if="approval.edited"> · {{ i18n.t("approval.edited") }}</template>
          <template v-if="approval.reason"> · {{ i18n.t("approval.reason", { reason: approval.reason }) }}</template>
          <template v-if="approval.status === 'expired'">{{ i18n.t("approval.expiredNote") }}</template>
        </span>
      </div>
    </div>
  </div>
</template>
