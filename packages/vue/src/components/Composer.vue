<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { Attachment } from "@klymbak/client";
import KlIcon from "./KlIcon.vue";

const props = withDefaults(
  defineProps<{ running?: boolean; disabled?: boolean; placeholder?: string; acceptImages?: boolean }>(),
  { placeholder: "Ask anything, or tell the agent what to do…" },
);
const emit = defineEmits<{ send: [text: string, attachments: Attachment[]]; stop: [] }>();

const text = ref("");
const attachments = ref<Attachment[]>([]);
const input = ref<HTMLTextAreaElement>();
const fileInput = ref<HTMLInputElement>();

const canSend = computed(() => !props.disabled && (text.value.trim().length > 0 || attachments.value.length > 0));
const hint = computed(() =>
  props.running ? "The agent is working. Anything you send now is added as an instruction it reads after the current step." : "",
);

function resize() {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
}

function submit() {
  if (!canSend.value) return;
  emit("send", text.value, attachments.value);
  text.value = "";
  attachments.value = [];
  void nextTick(resize);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}

async function addFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) continue;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    attachments.value.push({ name: file.name, mimeType: file.type, data });
  }
}

function onPaste(event: ClipboardEvent) {
  if (!props.acceptImages) return;
  const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
  if (files.length) {
    event.preventDefault();
    void addFiles(files);
  }
}

function focus() {
  input.value?.focus();
}

function setText(value: string) {
  text.value = value;
  void nextTick(() => {
    resize();
    focus();
  });
}

defineExpose({ focus, setText });
</script>

<template>
  <form class="kl-composer" :class="{ 'kl-composer--running': running }" @submit.prevent="submit">
    <div v-if="attachments.length" class="kl-composer__files">
      <span v-for="(file, i) in attachments" :key="i" class="kl-composer__file">
        <img :src="`data:${file.mimeType};base64,${file.data}`" :alt="file.name" />
        <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" :aria-label="`Remove ${file.name}`" @click="attachments.splice(i, 1)">
          <KlIcon name="close" :size="12" />
        </button>
      </span>
    </div>
    <textarea
      ref="input"
      v-model="text"
      class="kl-composer__input"
      rows="1"
      :placeholder="running ? 'Add an instruction while the agent works…' : placeholder"
      :disabled="disabled"
      aria-label="Message"
      @input="resize"
      @keydown="onKeydown"
      @paste="onPaste"
    />
    <div class="kl-composer__bar">
      <slot name="tools" />
      <button
        v-if="acceptImages"
        type="button"
        class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
        aria-label="Attach an image"
        title="Attach an image"
        @click="fileInput?.click()"
      >
        <KlIcon name="image" :size="15" />
      </button>
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="addFiles(($event.target as HTMLInputElement).files ?? [])" />
      <span class="kl-composer__spacer" />
      <button v-if="running" type="button" class="kl-btn kl-btn--sm" @click="emit('stop')">
        <KlIcon name="stop" :size="12" /> Stop
      </button>
      <button type="submit" class="kl-btn kl-btn--primary kl-btn--icon kl-composer__send" :disabled="!canSend" :aria-label="running ? 'Send instruction' : 'Send'">
        <KlIcon name="send" :size="16" />
      </button>
    </div>
    <p v-if="hint" class="kl-composer__hint">{{ hint }}</p>
  </form>
</template>
