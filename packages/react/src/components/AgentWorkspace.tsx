import { useState, type ReactNode } from "react";
import type { UiAction } from "@klymbak/protocol";
import { selectUnreadCount } from "@klymbak/client";
import {
  I18nProvider,
  RenderersProvider,
  RootProvider,
  StoreProvider,
  mergeRenderers,
  useRenderers,
  useResolvedI18n,
  useResolvedStore,
  type I18nSource,
  type KlymbakRenderers,
  type StoreSource,
} from "../context";
import { cx } from "../util";
import { AgentChat } from "./AgentChat";
import { CapabilitiesPanel } from "./CapabilitiesPanel";
import { KlIcon } from "./KlIcon";
import { SchedulePanel } from "./SchedulePanel";
import { SessionList } from "./SessionList";
import { ToastStack } from "./ToastStack";

export interface AgentWorkspaceProps extends StoreSource, I18nSource {
  /** The app's name in the sidebar and the chat. Defaults to the server's app.name. */
  title?: string;
  /** Text under the title on the welcome screen. Defaults to the server's app.description. */
  description?: string;
  suggestions?: string[];
  theme?: "auto" | "light" | "dark";
  renderers?: KlymbakRenderers;
  /** Show model, tokens and cost under each answer. */
  showMeta?: boolean;
  onAction?: (action: UiAction) => void;
  /** Replaces the logo and app name at the top of the sidebar. */
  brand?: ReactNode;
  /** Replaces the signed-in user at the bottom of the sidebar. */
  sidebarFooter?: ReactNode;
  headerEnd?: ReactNode;
}

type Tab = "chats" | "schedules" | "capabilities";

/** Full screen: conversations, schedules and capabilities in a sidebar, next to the chat. */
export function AgentWorkspace(props: AgentWorkspaceProps) {
  const { title, description, suggestions, theme = "auto", renderers, showMeta = true, onAction, brand, sidebarFooter, headerEnd } = props;
  const i18n = useResolvedI18n(props);
  const store = useResolvedStore(props, "AgentWorkspace", i18n.locale);
  const inherited = useRenderers();
  const [tab, setTab] = useState<Tab>("chats");
  const [drawer, setDrawer] = useState(false);
  const { state } = store;

  const tabs = [
    { id: "chats" as const, label: i18n.t("workspace.chats"), icon: "chat", badge: selectUnreadCount(state) || undefined },
    ...(state.config?.features.schedules ? [{ id: "schedules" as const, label: i18n.t("workspace.schedules"), icon: "clock", badge: undefined }] : []),
    { id: "capabilities" as const, label: i18n.t("workspace.tools"), icon: "tool", badge: undefined },
  ];

  function showChat() {
    setTab("chats");
    setDrawer(false);
  }

  return (
    <StoreProvider value={store}>
      <RenderersProvider value={renderers ? mergeRenderers(inherited, renderers) : inherited}>
        <I18nProvider value={i18n}>
          <RootProvider value={true}>
            <div className={cx("kl-root kl-workspace", drawer && "kl-workspace--drawer")} data-kl-theme={theme}>
              <aside className="kl-workspace__sidebar" aria-label={i18n.t("workspace.navigation")}>
                <div className="kl-workspace__brand">
                  {brand ?? (
                    <>
                      <span className="kl-workspace__logo">
                        <KlIcon name="sparkle" size={16} />
                      </span>
                      <span className="kl-workspace__app">{title ?? state.config?.app.name ?? i18n.t("chat.defaultTitle")}</span>
                    </>
                  )}
                  <button
                    type="button"
                    className="kl-btn kl-btn--ghost kl-btn--icon kl-workspace__close"
                    aria-label={i18n.t("workspace.closeMenu")}
                    onClick={() => setDrawer(false)}
                  >
                    <KlIcon name="close" size={16} />
                  </button>
                </div>
                <div className="kl-workspace__tabs" role="tablist">
                  {tabs.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="tab"
                      aria-selected={tab === item.id}
                      className={cx("kl-workspace__tab", tab === item.id && "active")}
                      onClick={() => setTab(item.id)}
                    >
                      <KlIcon name={item.icon} size={14} /> {item.label}
                      {item.badge && <span className="kl-workspace__badge">{item.badge}</span>}
                    </button>
                  ))}
                </div>
                <div className="kl-workspace__panel kl-scroll">
                  {tab === "chats" ? (
                    <SessionList onOpen={() => setDrawer(false)} />
                  ) : tab === "schedules" ? (
                    <SchedulePanel onOpenSession={showChat} />
                  ) : (
                    <CapabilitiesPanel />
                  )}
                </div>
                <div className="kl-workspace__footer">
                  {sidebarFooter ??
                    (state.config && (
                      <>
                        <span className="kl-workspace__avatar">{state.config.user.name.slice(0, 1)}</span>
                        <span className="kl-workspace__user">
                          <strong>{state.config.user.name}</strong>
                          <span className="kl-faint">{state.config.user.roles.join(", ")}</span>
                        </span>
                      </>
                    ))}
                </div>
              </aside>
              <div className="kl-workspace__scrim" onClick={() => setDrawer(false)} />
              <main className="kl-workspace__main">
                <AgentChat
                  title={title}
                  description={description}
                  suggestions={suggestions}
                  showMeta={showMeta}
                  onAction={onAction}
                  headerStart={
                    <button
                      type="button"
                      className="kl-btn kl-btn--ghost kl-btn--icon kl-workspace__menu"
                      aria-label={i18n.t("workspace.openMenu")}
                      onClick={() => setDrawer(true)}
                    >
                      <KlIcon name="menu" size={18} />
                    </button>
                  }
                  headerEnd={headerEnd}
                />
              </main>
              <ToastStack onOpenSession={showChat} />
            </div>
          </RootProvider>
        </I18nProvider>
      </RenderersProvider>
    </StoreProvider>
  );
}
