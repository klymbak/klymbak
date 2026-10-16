import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";

const CHARS_PER_TOKEN = 4;
const IMAGE_TOKENS = 1_200;
const KEEP_RECENT_MESSAGES = 8;
const SHRUNK_RESULT_CHARS = 600;

export function estimateTokens(messages: readonly AgentMessage[]): number {
  let chars = 0;
  let images = 0;
  for (const message of messages) {
    const content = (message as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === "image") images++;
        else chars += JSON.stringify(block).length;
      }
    } else {
      chars += JSON.stringify(message).length;
    }
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + images * IMAGE_TOKENS;
}

/**
 * Keeps long conversations inside the model's context window. Runs before every model call.
 *
 * 1. Shrinks tool results older than the last few messages (they are usually tables
 *    the user already saw).
 * 2. If that is not enough, drops the oldest whole turns. System messages always stay,
 *    because they carry the prompt and tool declarations.
 */
export function createContextManager(getModel: () => Model<Api>) {
  return async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    try {
      const model = getModel();
      const budget = Math.max(4_000, Math.floor(model.contextWindow * 0.85) - Math.min(model.maxTokens, 8_192));
      if (estimateTokens(messages) <= budget) return messages;

      const cutoff = messages.length - KEEP_RECENT_MESSAGES;
      let result = messages.map((message, i) => (i < cutoff && message.role === "toolResult" ? shrink(message) : message));
      if (estimateTokens(result) <= budget) return result;

      const turnStarts = result.flatMap((message, i) => (message.role === "user" ? [i] : []));
      let dropBefore = 0;
      for (let t = 1; t < turnStarts.length; t++) {
        dropBefore = turnStarts[t]!;
        const candidate = result.filter((message, i) => message.role === "system" || i >= dropBefore);
        if (estimateTokens(candidate) <= budget) return candidate;
      }
      result = result.filter((message, i) => message.role === "system" || i >= dropBefore);
      return result;
    } catch {
      return messages;
    }
  };
}

function shrink(message: AgentMessage): AgentMessage {
  if (message.role !== "toolResult") return message;
  let changed = false;
  const content = message.content.map((block) => {
    if (block.type !== "text" || block.text.length <= SHRUNK_RESULT_CHARS) return block;
    changed = true;
    return {
      ...block,
      text: `${block.text.slice(0, SHRUNK_RESULT_CHARS)}\n[Older result shortened to save context. Call the tool again if you need the full data.]`,
    };
  });
  return changed ? { ...message, content } : message;
}
