import "@klymbak/client/style.css";

export { AgentWorkspace } from "./components/AgentWorkspace";
export type { AgentWorkspaceProps } from "./components/AgentWorkspace";
export { AgentChat } from "./components/AgentChat";
export type { AgentChatProps, AgentChatHandle } from "./components/AgentChat";
export { AgentWidget } from "./components/AgentWidget";
export type { AgentWidgetProps } from "./components/AgentWidget";

// Building blocks, for custom layouts.
export { MessageList } from "./components/MessageList";
export { MessageItem } from "./components/MessageItem";
export { ToolCallCard } from "./components/ToolCallCard";
export { ApprovalPrompt } from "./components/ApprovalPrompt";
export { SubagentTrace } from "./components/SubagentTrace";
export { Composer } from "./components/Composer";
export type { ComposerProps, ComposerHandle } from "./components/Composer";
export { ModelPicker } from "./components/ModelPicker";
export { SessionList } from "./components/SessionList";
export { SchedulePanel } from "./components/SchedulePanel";
export { CapabilitiesPanel } from "./components/CapabilitiesPanel";
export { ToastStack } from "./components/ToastStack";
export { MarkdownContent } from "./components/MarkdownContent";
export { UiBlockView } from "./components/blocks/UiBlockView";
export { DataTable } from "./components/blocks/DataTable";
export { ChartView } from "./components/blocks/ChartView";
export { StatGrid } from "./components/blocks/StatGrid";
export { KeyValueList } from "./components/blocks/KeyValueList";
export { MediaGallery } from "./components/blocks/MediaGallery";

export { KlymbakProvider, useAgentStore, useChatActions, useI18n, useRenderers } from "./context";
export type { KlymbakProviderProps, KlymbakRenderers, ChatActions, I18nSource } from "./context";

export {
  createAgentClient,
  createAgentStore,
  AgentApiError,
  configureFormatting,
  formatValue,
  describeCron,
  timeAgo,
  createI18n,
  formatMessage,
  en,
  loadMessages,
  locales,
  matchLocale,
} from "@klymbak/client";
export type {
  AgentClient,
  AgentClientOptions,
  AgentState,
  AgentStore,
  AgentStoreOptions,
  Attachment,
  I18n,
  Locale,
  Message,
  MessageId,
  Messages,
  StreamOptions,
  Text,
  Toast,
} from "@klymbak/client";
export { applyEvent, pendingApprovals, ui } from "@klymbak/protocol";
export type * from "@klymbak/protocol";
