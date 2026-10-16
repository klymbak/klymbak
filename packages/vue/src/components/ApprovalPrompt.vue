<script setup lang="ts">
import { ref } from "vue";
import type { ApprovalView } from "@klymbak/protocol";
import { useOptionalAgentStore } from "../context";
import KlIcon from "./KlIcon.vue";

const props = defineProps<{ approval: ApprovalView }>();
const emit = defineEmits<{ decide: [decision: { approved: boolean; reason?: string; remember?: boolean }] }>();
const store = useOptionalAgentStore();

const remember = ref(false);
const reason = ref("");
const denying = ref(false);
const busy = ref(false);

const riskTone = { low: "info", medium: "warning", high: "danger" } as const;

async function decide(approved: boolean) {
  if (!approved && !denying.value) {
    denying.value = true;
    return;
  }
  busy.value = true;
  const decision = { approved, reason: reason.value.trim() || undefined, remember: approved && remember.value };
  emit("decide", decision);
  try {
    await store?.decide(props.approval.id, decision);
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
        <span>Needs your approval</span>
        <span v-if="approval.risk" class="kl-pill" :class="`kl-tone-${riskTone[approval.risk]}`">{{ approval.risk }} risk</span>
      </div>
      <p class="kl-approval__title">{{ approval.title }}</p>
      <p v-if="approval.description" class="kl-approval__desc">{{ approval.description }}</p>
      <label v-if="denying" class="kl-label kl-approval__reason">
        Why not? (optional, the agent will read this)
        <input v-model="reason" class="kl-input" type="text" placeholder="e.g. Offer a replacement instead" @keydown.enter="decide(false)" />
      </label>
      <div class="kl-approval__buttons">
        <button type="button" class="kl-btn kl-btn--primary" :disabled="busy" @click="decide(true)">
          <KlIcon name="check" :size="14" /> Approve
        </button>
        <button type="button" class="kl-btn" :disabled="busy" @click="decide(false)">
          <KlIcon name="x" :size="14" /> {{ denying ? "Confirm deny" : "Deny" }}
        </button>
        <label v-if="approval.rememberable && !denying" class="kl-approval__remember">
          <input v-model="remember" type="checkbox" />
          Don't ask again in this chat
        </label>
      </div>
    </template>
    <div v-else class="kl-approval__decided">
      <span class="kl-stamp" :class="`kl-stamp--${approval.status}`">{{ approval.status }}</span>
      <div class="kl-approval__summary">
        <span class="kl-approval__title">{{ approval.title }}</span>
        <span class="kl-faint">
          <template v-if="approval.decidedBy">by {{ approval.decidedBy }}</template>
          <template v-if="approval.reason"> · “{{ approval.reason }}”</template>
          <template v-if="approval.status === 'expired'">Nobody decided in time</template>
        </span>
      </div>
    </div>
  </div>
</template>
