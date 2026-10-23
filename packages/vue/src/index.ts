import "@klymbak/client/style.css";

export { default as AgentWorkspace } from "./components/AgentWorkspace.vue";
export { default as AgentChat } from "./components/AgentChat.vue";
export { default as AgentWidget } from "./components/AgentWidget.vue";

// Building blocks, for custom layouts.
export { default as MessageList } from "./components/MessageList.vue";
export { default as MessageItem } from "./components/MessageItem.vue";
export { default as ToolCallCard } from "./components/ToolCallCard.vue";
export { default as ApprovalPrompt } from "./components/ApprovalPrompt.vue";
export { default as SubagentTrace } from "./components/SubagentTrace.vue";
export { default as Composer } from "./components/Composer.vue";
export { default as ModelPicker } from "./components/ModelPicker.vue";
export { default as SessionList } from "./components/SessionList.vue";
export { default as SchedulePanel } from "./components/SchedulePanel.vue";
export { default as CapabilitiesPanel } from "./components/CapabilitiesPanel.vue";
export { default as ToastStack } from "./components/ToastStack.vue";
export { default as MarkdownContent } from "./components/MarkdownContent.vue";
export { default as UiBlockView } from "./components/blocks/UiBlockView.vue";
export { default as DataTable } from "./components/blocks/DataTable.vue";
export { default as ChartView } from "./components/blocks/ChartView.vue";
export { default as StatGrid } from "./components/blocks/StatGrid.vue";
export { default as KeyValueList } from "./components/blocks/KeyValueList.vue";
export { default as MediaGallery } from "./components/blocks/MediaGallery.vue";

export { createAgentClient, AgentApiError } from "@klymbak/client";
export type {
  AgentClient,
  AgentClientOptions,
  StreamOptions,
  AgentState,
  Attachment,
  I18n,
  Locale,
  Message,
  MessageId,
  Messages,
  Text,
  Toast,
} from "@klymbak/client";
export { createAgentStore } from "./store";
export type { AgentStore, AgentStoreOptions } from "./store";
export {
  Klymbak,
  provideAgentStore,
  provideI18n,
  useAgentStore,
  useChatActions,
  useI18n,
  useRenderers,
  provideRenderers,
} from "./context";
export type { KlymbakPluginOptions, KlymbakRenderers, ChatActions, I18nSource } from "./context";
export { configureFormatting, formatValue, describeCron, timeAgo, createI18n, en, formatMessage, loadMessages, locales, matchLocale } from "@klymbak/client";
export { applyEvent, pendingApprovals, ui } from "@klymbak/protocol";
export type * from "@klymbak/protocol";
