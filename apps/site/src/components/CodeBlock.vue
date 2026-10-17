<script setup lang="ts">
import { computed, ref } from "vue";

/** One file, or several shown as tabs (the same snippet in Vue, React and Angular). */
const props = defineProps<{ files: { file: string; source: string }[] }>();
const active = ref(0);
const source = computed(() => props.files[active.value]?.source ?? "");
const copied = ref(false);

const KEYWORDS = new Set([
  "export", "const", "let", "async", "await", "return", "if", "import", "from", "type", "interface", "new", "true", "false", "undefined", "null", "setup", "lang",
  "function", "class",
]);

/** A deliberately small highlighter for TS/Vue snippets: comments, strings, numbers, keywords, calls, tags. */
const html = computed(() => {
  const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const token = /(\/\/[^\n]*)|(`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|(<\/?[A-Za-z][\w-]*)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/g;
  let out = "";
  let last = 0;
  for (const match of source.value.matchAll(token)) {
    out += escape(source.value.slice(last, match.index));
    const [text, comment, string, tag, number, call, word] = match;
    if (comment) out += `<span class="c">${escape(text)}</span>`;
    else if (string) out += `<span class="s">${escape(text)}</span>`;
    else if (tag) out += `<span class="t">${escape(text)}</span>`;
    else if (number) out += `<span class="n">${escape(text)}</span>`;
    else if (call) out += KEYWORDS.has(call) ? `<span class="k">${escape(text)}</span>` : `<span class="f">${escape(text)}</span>`;
    else if (word && KEYWORDS.has(word)) out += `<span class="k">${escape(text)}</span>`;
    else out += escape(text);
    last = match.index! + text.length;
  }
  return out + escape(source.value.slice(last));
});

async function copy() {
  try {
    await navigator.clipboard.writeText(source.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1400);
  } catch {
    // Clipboard refused; the code is still selectable.
  }
}
</script>

<template>
  <div class="code">
    <div class="code__bar">
      <div v-if="files.length > 1" class="code__tabs" role="group" aria-label="Framework">
        <button v-for="(f, i) in files" :key="f.file" type="button" class="code__tab" :aria-pressed="i === active" @click="active = i">{{ f.file }}</button>
      </div>
      <span v-else class="code__file">{{ files[0]?.file }}</span>
      <button type="button" class="code__copy" @click="copy">{{ copied ? "Copied" : "Copy" }}</button>
    </div>
    <pre><code v-html="html" /></pre>
  </div>
</template>

<style scoped>
.code {
  border: 1.5px solid var(--ink);
  border-radius: 10px;
  overflow: hidden;
  background: #101614;
  color: #dfe6e2;
  min-width: 0;
}
.code__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  border-bottom: 1px solid #26302b;
  font-family: var(--font-mono);
  font-size: 0.74rem;
  color: #93a29a;
}
.code__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: -3px 0;
}
.code__tab {
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.code__tab:hover {
  color: #fff;
}
.code__tab[aria-pressed="true"] {
  border-color: #36423b;
  background: #1c2521;
  color: #fff;
}
.code__copy {
  padding: 2px 8px;
  border: 1px solid #36423b;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.code__copy:hover {
  color: #fff;
}
pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.82rem;
  line-height: 1.6;
}
:deep(.k) {
  color: #ff9ea1;
}
:deep(.s) {
  color: #a8e1b2;
}
:deep(.n) {
  color: #f6c177;
}
:deep(.f) {
  color: #8fb7ff;
}
:deep(.t) {
  color: #ff9ea1;
}
:deep(.c) {
  color: #7d8b84;
  font-style: italic;
}
</style>
