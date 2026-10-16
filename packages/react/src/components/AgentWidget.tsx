import { useRef, useState } from "react";
import type { UiAction } from "@klymbak/protocol";
import { selectApprovals } from "@klymbak/client";
import { RenderersProvider, RootProvider, StoreProvider, mergeRenderers, useRenderers, useResolvedStore, type KlymbakRenderers, type StoreSource } from "../context";
import { useTransition } from "../transition";
import { AgentChat } from "./AgentChat";
import { KlIcon } from "./KlIcon";
import { ToastStack } from "./ToastStack";

export interface AgentWidgetProps extends StoreSource {
  title?: string;
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
  const { title, label = "Ask the agent", suggestions, theme = "auto", renderers, position = "right", defaultOpen = false, onAction } = props;
  const store = useResolvedStore(props, "AgentWidget");
  const inherited = useRenderers();
  const [open, setOpen] = useState(defaultOpen);
  const panel = useRef<HTMLDivElement>(null);
  const panelVisible = useTransition(panel, open, "kl-widget");

  return (
    <StoreProvider value={store}>
      <RenderersProvider value={renderers ? mergeRenderers(inherited, renderers) : inherited}>
        <RootProvider value={true}>
          <div className={`kl-root kl-widget kl-widget--${position}`} data-kl-theme={theme}>
            <div
              ref={panel}
              className="kl-widget__panel"
              role="dialog"
              aria-label={title ?? "Agent"}
              style={panelVisible ? undefined : { display: "none" }}
            >
              <AgentChat
                title={title}
                suggestions={suggestions}
                onAction={onAction}
                headerEnd={
                  <button type="button" className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" aria-label="Close" onClick={() => setOpen(false)}>
                    <KlIcon name="close" size={14} />
                  </button>
                }
              />
            </div>
            {!open && (
              <button type="button" className="kl-widget__launcher" onClick={() => setOpen(true)}>
                <KlIcon name="sparkle" size={18} />
                <span>{label}</span>
                {selectApprovals(store.state).length > 0 && <span className="kl-widget__dot" aria-label="Approval waiting" />}
              </button>
            )}
            <ToastStack onOpenSession={() => setOpen(true)} />
          </div>
        </RootProvider>
      </RenderersProvider>
    </StoreProvider>
  );
}
