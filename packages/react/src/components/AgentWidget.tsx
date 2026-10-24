import { useRef, useState } from "react";
import type { UiAction } from "@klymbak/protocol";
import { selectApprovals } from "@klymbak/client";
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
import { useTransition } from "../transition";
import { AgentChat } from "./AgentChat";
import { KlIcon } from "./KlIcon";
import { ToastStack } from "./ToastStack";

export interface AgentWidgetProps extends StoreSource, I18nSource {
  title?: string;
  /** Text under the title on the welcome screen. Defaults to the server's app.description. */
  description?: string;
  label?: string;
  suggestions?: string[];
  theme?: "auto" | "light" | "dark";
  renderers?: KlymbakRenderers;
  position?: "right" | "left";
  defaultOpen?: boolean;
  onAction?: (action: UiAction) => void;
}

/**
 * A floating launcher + chat panel that drops into any existing page,
 * so teams can add the agent next to their current admin panel first.
 */
export function AgentWidget(props: AgentWidgetProps) {
  const { title, description, suggestions, theme = "auto", renderers, position = "right", defaultOpen = false, onAction } = props;
  const i18n = useResolvedI18n(props);
  const store = useResolvedStore(props, "AgentWidget", i18n.locale);
  const inherited = useRenderers();
  const [open, setOpen] = useState(defaultOpen);
  const panel = useRef<HTMLDivElement>(null);
  const panelVisible = useTransition(panel, open, "kl-widget");
  const label = props.label ?? i18n.t("widget.launcher");

  return (
    <StoreProvider value={store}>
      <RenderersProvider value={renderers ? mergeRenderers(inherited, renderers) : inherited}>
        <I18nProvider value={i18n}>
          <RootProvider value={true}>
            <div className={`kl-root kl-widget kl-widget--${position}`} data-kl-theme={theme}>
              <div
                ref={panel}
                className="kl-widget__panel"
                role="dialog"
                aria-label={title ?? i18n.t("widget.label")}
                style={panelVisible ? undefined : { display: "none" }}
              >
                <AgentChat
                  title={title}
                  description={description}
                  suggestions={suggestions}
                  onAction={onAction}
                  headerEnd={
                    <button
                      type="button"
                      className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
                      aria-label={i18n.t("common.close")}
                      onClick={() => setOpen(false)}
                    >
                      <KlIcon name="close" size={14} />
                    </button>
                  }
                />
              </div>
              {!open && (
                <button type="button" className="kl-widget__launcher" onClick={() => setOpen(true)}>
                  <KlIcon name="sparkle" size={18} />
                  <span>{label}</span>
                  {selectApprovals(store.state).length > 0 && <span className="kl-widget__dot" aria-label={i18n.t("widget.approvalWaiting")} />}
                </button>
              )}
              <ToastStack onOpenSession={() => setOpen(true)} />
            </div>
          </RootProvider>
        </I18nProvider>
      </RenderersProvider>
    </StoreProvider>
  );
}
