import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import type { UiAction } from "@klymbak/protocol";
import { selectCurrentModel, selectCurrentSession, type AgentStore } from "@klymbak/client";
import {
  ChatActionsProvider,
  I18nProvider,
  mergeRenderers,
  RenderersProvider,
  RootProvider,
  StoreProvider,
  useInsideRoot,
  useRenderers,
  useResolvedI18n,
  useResolvedStore,
  type ChatActions,
  type I18nSource,
  type KlymbakRenderers,
  type StoreSource,
} from "../context";
import { cx } from "../util";
import { Composer, type ComposerHandle } from "./Composer";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";
import { KlIcon } from "./KlIcon";

export interface AgentChatProps extends StoreSource, I18nSource {
  title?: string;
  /** Text under the title on the welcome screen. Defaults to the server's app.description. */
  description?: string;
  /** Starter prompts for an empty conversation. Defaults to the server's app.suggestions. */
  suggestions?: string[];
  placeholder?: string;
  theme?: "auto" | "light" | "dark";
  renderers?: KlymbakRenderers;
  showHeader?: boolean;
  /** Show model, tokens and cost under each answer. */
  showMeta?: boolean;
  /** A UI block asked the host app to do something (kind: "event"). */
  onAction?: (action: UiAction) => void;
  /** What the person has open (the record on screen, the selected rows). Sent to the model only. */
  context?: string;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  /** Replaces the welcome screen of an empty conversation. */
  empty?: ReactNode;
  className?: string;
}

export interface AgentChatHandle {
  store: AgentStore;
  focus(): void;
  setDraft(text: string): void;
}

export const AgentChat = forwardRef<AgentChatHandle, AgentChatProps>(function AgentChat(props, ref) {
  const { title, placeholder, theme = "auto", renderers, showHeader = true, showMeta = false, onAction, context, headerStart, headerEnd, empty, className } = props;
  const store = useResolvedStore(props, "AgentChat");
  const i18n = useResolvedI18n(props);
  const inherited = useRenderers();
  const insideRoot = useInsideRoot();
  const composer = useRef<ComposerHandle>(null);

  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;
  const actions = useMemo<ChatActions>(
    () => ({ sendPrompt: (text) => void store.send(text), emitAction: (action) => onActionRef.current?.(action) }),
    [store],
  );
  const mergedRenderers = useMemo(() => (renderers ? mergeRenderers(inherited, renderers) : inherited), [inherited, renderers]);

  useEffect(() => {
    if (context === undefined) return;
    store.setContext(context);
    return () => store.setContext(undefined);
  }, [store, context]);

  useImperativeHandle(ref, () => ({ store, focus: () => composer.current?.focus(), setDraft: (text) => composer.current?.setText(text) }), [store]);

  const { state } = store;
  const suggestions = props.suggestions ?? state.config?.app.suggestions ?? [];
  const heading = title ?? state.config?.app.name ?? i18n.t("chat.defaultTitle");
  const description = props.description ?? state.config?.app.description;
  const sessionTitle = selectCurrentSession(state)?.title;
  const acceptImages = Boolean(selectCurrentModel(state)?.input.includes("image")) && Boolean(state.config?.features.attachments);

  const welcome = !state.loadingSession && (
    <div className="kl-welcome">
      <span className="kl-welcome__mark">
        <KlIcon name="sparkle" size={20} />
      </span>
      <h2 className="kl-welcome__title">{heading}</h2>
      {description && <p className="kl-welcome__text">{description}</p>}
      {suggestions.length > 0 && (
        <div className="kl-welcome__suggestions">
          {suggestions.map((suggestion) => (
            <button key={suggestion} type="button" className="kl-welcome__suggestion" onClick={() => void store.send(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <StoreProvider value={store}>
      <RenderersProvider value={mergedRenderers}>
        <I18nProvider value={i18n}>
          <ChatActionsProvider value={actions}>
            <RootProvider value={true}>
              <section
                className={cx("kl-chat", !insideRoot && "kl-root", className)}
                data-kl-theme={insideRoot ? undefined : theme}
                aria-label={i18n.t("chat.label")}
              >
                {showHeader && (
                  <header className="kl-chat__header">
                    {headerStart}
                    <div className="kl-chat__titles">
                      <span className="kl-chat__title">{sessionTitle ?? heading}</span>
                      {sessionTitle && <span className="kl-chat__subtitle">{heading}</span>}
                    </div>
                    {state.running && (
                      <span className="kl-chat__status">
                        <span className="kl-spinner" /> {i18n.t("chat.working")}
                      </span>
                    )}
                    {headerEnd}
                    <button type="button" className="kl-btn kl-btn--sm" disabled={!state.sessionId} onClick={() => store.newSession()}>
                      <KlIcon name="plus" size={14} /> {i18n.t("chat.newChat")}
                    </button>
                  </header>
                )}

                {state.error ? (
                  <div className="kl-chat__fatal">
                    <KlIcon name="alert" size={18} />
                    <div>
                      <strong>{i18n.t("chat.unreachable")}</strong>
                      <p>{i18n.text(state.error)}</p>
                      <button type="button" className="kl-btn kl-btn--sm" onClick={() => void store.init()}>
                        {i18n.t("chat.retry")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <MessageList messages={state.messages} running={state.running} showMeta={showMeta} empty={empty ?? welcome} />
                )}

                <div className="kl-chat__footer">
                  {state.runError && (
                    <div className="kl-chat__error" role="alert">
                      <KlIcon name="alert" size={14} /> {i18n.text(state.runError)}
                    </div>
                  )}
                  <Composer
                    ref={composer}
                    running={state.running}
                    disabled={!state.ready}
                    placeholder={placeholder}
                    acceptImages={acceptImages}
                    onSend={(text, attachments) => void store.send(text, attachments)}
                    onStop={() => void store.abort()}
                    tools={<ModelPicker />}
                  />
                </div>
              </section>
            </RootProvider>
          </ChatActionsProvider>
        </I18nProvider>
      </RenderersProvider>
    </StoreProvider>
  );
});
