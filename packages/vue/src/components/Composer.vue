<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, watch } from "vue";
import type { McpCompleteRequest, McpPromptInfo, McpResourceInfo, McpResourceTemplateInfo } from "@klymbak/protocol";
import {
  createSuggester,
  findMention,
  insertMention,
  mentionKey,
  mentionOptions,
  promptFields,
  promptLabel,
  promptReady,
  removeMention,
  templateFields,
  templateReady,
  type Attachment,
  type McpReferences,
  type MentionOption,
  type ReferenceFields,
} from "@klymbak/client";
import { useI18n } from "../context";
import KlIcon from "./KlIcon.vue";

const props = defineProps<{
  running?: boolean;
  disabled?: boolean;
  placeholder?: string;
  acceptImages?: boolean;
  /** MCP resources to offer after @. */
  resources?: McpResourceInfo[];
  /** MCP resource templates to offer after @, each asking for its variables. */
  resourceTemplates?: McpResourceTemplateInfo[];
  /** MCP prompts to offer after / at the start of the message. */
  prompts?: McpPromptInfo[];
  /** Where suggestions for a prompt's arguments and a template's variables come from. */
  complete?: (request: McpCompleteRequest) => Promise<string[]>;
}>();
const emit = defineEmits<{ send: [text: string, attachments: Attachment[], references: McpReferences]; stop: [] }>();
const i18n = useI18n();

const text = ref("");
const attachments = ref<Attachment[]>([]);
const mentioned = ref<McpResourceInfo[]>([]);
/** Resources from templates, each waiting for its values. */
const templated = ref<{ id: number; template: McpResourceTemplateInfo; values: Record<string, string> }[]>([]);
const prompt = ref<McpPromptInfo>();
const values = ref<Record<string, string>>({});
const form = ref<HTMLFormElement>();
const input = ref<HTMLTextAreaElement>();
const fileInput = ref<HTMLInputElement>();
let nextTemplateId = 0;

// The @ and / menu follows the caret while the box has focus.
const caret = ref(0);
const focused = ref(false);
/** Where a mention closed with Escape starts: its menu stays closed until another one begins. */
const dismissed = ref<number>();
const active = ref(0);
const menuId = useId();

const mention = computed(() => (focused.value && !props.running && !props.disabled ? findMention(text.value, caret.value) : undefined));
const options = computed(() =>
  mention.value && mention.value.start !== dismissed.value
    ? mentionOptions(
        mention.value,
        { resources: props.resources, resourceTemplates: props.resourceTemplates, prompts: props.prompts },
        { resources: mentioned.value, prompt: prompt.value },
      )
    : [],
);
watch(
  () => mention.value && `${mention.value.start}:${mention.value.query}`,
  () => {
    active.value = 0;
    if (mention.value?.start !== dismissed.value) dismissed.value = undefined;
  },
);

/** The values a chosen prompt and each templated resource ask for, one group of fields each. */
const groups = computed<{ key: string; fields: ReferenceFields; values: Record<string, string> }[]>(() => [
  ...(prompt.value?.arguments.length ? [{ key: "prompt", fields: promptFields(prompt.value), values: values.value }] : []),
  ...templated.value.map((entry) => ({ key: `t${entry.id}`, fields: templateFields(entry.template), values: entry.values })),
]);

// Suggestions for the field being typed into, from the server, as a datalist.
const suggestions = reactive<Record<string, string[]>>({});
const suggester = createSuggester(
  (request) => props.complete?.(request) ?? Promise.resolve([]),
  (key, found) => (suggestions[key] = found),
);
onBeforeUnmount(() => suggester.dispose());

function suggest(group: (typeof groups.value)[number], name: string) {
  if (group.fields.completes && props.complete) suggester.ask(`${group.key}:${name}`, group.fields.request(name, group.values));
}

function setValue(group: (typeof groups.value)[number], name: string, value: string) {
  group.values[name] = value;
  suggest(group, name);
}

const canSend = computed(
  () =>
    !props.disabled &&
    (!prompt.value || promptReady(prompt.value, values.value)) &&
    templated.value.every((entry) => templateReady(entry.template, entry.values)) &&
    Boolean(text.value.trim() || attachments.value.length || mentioned.value.length || templated.value.length || prompt.value),
);
const hint = computed(() => (props.running ? i18n.t("composer.runningHint") : ""));

function resize() {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
}

function submit() {
  if (!canSend.value) return;
  emit("send", text.value, attachments.value, {
    resources: mentioned.value,
    templates: templated.value.map(({ template, values }) => ({ template, values })),
    prompt: prompt.value,
    arguments: values.value,
  });
  text.value = "";
  attachments.value = [];
  mentioned.value = [];
  templated.value = [];
  prompt.value = undefined;
  values.value = {};
  void nextTick(resize);
}

function syncCaret() {
  caret.value = input.value?.selectionStart ?? text.value.length;
}

function onInput() {
  resize();
  syncCaret();
}

function choose(option: MentionOption) {
  const current = mention.value;
  if (!current) return;
  let edit: { text: string; caret: number };
  // The group whose first field takes the focus, when the choice asks for values.
  let fields: string | undefined;
  if (option.resource) {
    mentioned.value.push(option.resource);
    edit = insertMention(text.value, current, option.resource.name);
  } else if (option.template) {
    const id = nextTemplateId++;
    templated.value.push({ id, template: option.template, values: {} });
    edit = insertMention(text.value, current, option.template.name);
    fields = `t${id}`;
  } else {
    prompt.value = option.prompt;
    values.value = {};
    edit = removeMention(text.value, current);
    if (option.prompt?.arguments.length) fields = "prompt";
  }
  text.value = edit.text;
  caret.value = edit.caret;
  void nextTick(() => {
    resize();
    input.value?.setSelectionRange(edit.caret, edit.caret);
    if (fields) form.value?.querySelector<HTMLInputElement>(`[data-fields="${fields}"] input`)?.focus();
  });
}

function onKeydown(event: KeyboardEvent) {
  if (options.value.length && !event.shiftKey && !event.isComposing) {
    const action = mentionKey(event.key, active.value, options.value.length);
    if (action !== undefined) {
      event.preventDefault();
      if (action === "choose") choose(options.value[active.value]!);
      else if (action === "close") dismissed.value = mention.value!.start;
      else active.value = action;
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
}

function removePrompt() {
  prompt.value = undefined;
  values.value = {};
  focus();
}

function fieldLabel(field: ReferenceFields["fields"][number]) {
  return field.required ? field.label : i18n.t("composer.optional", { name: field.label });
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
  <form ref="form" class="kl-composer" :class="{ 'kl-composer--running': running }" @submit.prevent="submit">
    <div v-if="options.length" :id="menuId" class="kl-mention-menu kl-scroll" role="listbox" :aria-label="i18n.t(mention?.kind === 'prompt' ? 'composer.prompts' : 'composer.resources')">
      <span class="kl-mention-menu__title" aria-hidden="true">{{ i18n.t(mention?.kind === "prompt" ? "composer.prompts" : "composer.resources") }}</span>
      <div
        v-for="(option, i) in options"
        :id="`${menuId}-${i}`"
        :key="option.key"
        role="option"
        class="kl-mention-menu__option"
        :class="{ 'kl-mention-menu__option--active': i === active }"
        :aria-selected="i === active"
        @mousedown.prevent
        @mousemove="active = i"
        @click="choose(option)"
      >
        <KlIcon :name="option.prompt ? 'chat' : option.template ? 'database' : 'file'" :size="14" />
        <span class="kl-mention-menu__text">
          <span class="kl-mention-menu__name">{{ option.name }}</span>
          <span v-if="option.detail" class="kl-mention-menu__detail">{{ option.detail }}</span>
        </span>
        <span class="kl-mention-menu__server">{{ option.server }}</span>
      </div>
    </div>
    <div v-if="prompt || mentioned.length || templated.length" class="kl-composer__refs">
      <span v-if="prompt" class="kl-ref kl-ref--prompt" :title="prompt.description">
        <KlIcon name="chat" :size="12" />
        <span class="kl-ref__name">/{{ promptLabel(prompt) }}</span>
        <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" :aria-label="i18n.t('composer.removeFile', { name: promptLabel(prompt) })" @click="removePrompt">
          <KlIcon name="close" :size="10" />
        </button>
      </span>
      <span v-for="(resource, i) in mentioned" :key="`${resource.server}:${resource.uri}`" class="kl-ref" :title="resource.uri">
        <KlIcon name="file" :size="12" />
        <span class="kl-ref__name">{{ resource.name }}</span>
        <button
          type="button"
          class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
          :aria-label="i18n.t('composer.removeFile', { name: resource.name })"
          @click="mentioned.splice(i, 1)"
        >
          <KlIcon name="close" :size="10" />
        </button>
      </span>
      <span v-for="(entry, i) in templated" :key="entry.id" class="kl-ref" :title="entry.template.uriTemplate">
        <KlIcon name="database" :size="12" />
        <span class="kl-ref__name">{{ entry.template.name }}</span>
        <button
          type="button"
          class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
          :aria-label="i18n.t('composer.removeFile', { name: entry.template.name })"
          @click="templated.splice(i, 1)"
        >
          <KlIcon name="close" :size="10" />
        </button>
      </span>
    </div>
    <div
      v-for="group in groups"
      :key="group.key"
      class="kl-composer__args"
      role="group"
      :data-fields="group.key"
      :aria-label="i18n.t('composer.promptValues', { name: group.fields.label })"
    >
      <span v-if="groups.length > 1" class="kl-composer__args-label" aria-hidden="true">{{ group.fields.label }}</span>
      <template v-for="(field, i) in group.fields.fields" :key="field.name">
        <input
          :value="group.values[field.name] ?? ''"
          class="kl-input kl-composer__arg"
          :placeholder="fieldLabel(field)"
          :aria-label="fieldLabel(field)"
          :title="field.description"
          :required="field.required"
          :list="group.fields.completes && complete ? `${menuId}-${group.key}-${i}` : undefined"
          autocomplete="off"
          @input="setValue(group, field.name, ($event.target as HTMLInputElement).value)"
          @focus="suggest(group, field.name)"
        />
        <datalist v-if="group.fields.completes && complete" :id="`${menuId}-${group.key}-${i}`">
          <option v-for="value in suggestions[`${group.key}:${field.name}`] ?? []" :key="value" :value="value" />
        </datalist>
      </template>
    </div>
    <div v-if="attachments.length" class="kl-composer__files">
      <span v-for="(file, i) in attachments" :key="i" class="kl-composer__file">
        <img :src="`data:${file.mimeType};base64,${file.data}`" :alt="file.name" />
        <button
          type="button"
          class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
          :aria-label="i18n.t('composer.removeFile', { name: file.name })"
          @click="attachments.splice(i, 1)"
        >
          <KlIcon name="close" :size="12" />
        </button>
      </span>
    </div>
    <textarea
      ref="input"
      v-model="text"
      class="kl-composer__input"
      rows="1"
      :placeholder="running ? i18n.t('composer.placeholderRunning') : (placeholder ?? i18n.t('composer.placeholder'))"
      :disabled="disabled"
      :aria-label="i18n.t('composer.label')"
      :aria-autocomplete="resources?.length || resourceTemplates?.length || prompts?.length ? 'list' : undefined"
      :aria-controls="options.length ? menuId : undefined"
      :aria-activedescendant="options.length ? `${menuId}-${active}` : undefined"
      @input="onInput"
      @keydown="onKeydown"
      @keyup="syncCaret"
      @click="syncCaret"
      @focus="focused = true"
      @blur="focused = false"
      @paste="onPaste"
    />
    <div class="kl-composer__bar">
      <slot name="tools" />
      <button
        v-if="acceptImages"
        type="button"
        class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
        :aria-label="i18n.t('composer.attachImage')"
        :title="i18n.t('composer.attachImage')"
        @click="fileInput?.click()"
      >
        <KlIcon name="image" :size="15" />
      </button>
      <input ref="fileInput" type="file" accept="image/*" multiple hidden @change="addFiles(($event.target as HTMLInputElement).files ?? [])" />
      <span class="kl-composer__spacer" />
      <button v-if="running" type="button" class="kl-btn kl-btn--sm" @click="emit('stop')">
        <KlIcon name="stop" :size="12" /> {{ i18n.t("composer.stop") }}
      </button>
      <button
        type="submit"
        class="kl-btn kl-btn--primary kl-btn--icon kl-composer__send"
        :disabled="!canSend"
        :aria-label="i18n.t(running ? 'composer.sendInstruction' : 'composer.send')"
      >
        <KlIcon name="send" :size="16" />
      </button>
    </div>
    <p v-if="hint" class="kl-composer__hint">{{ hint }}</p>
  </form>
</template>
