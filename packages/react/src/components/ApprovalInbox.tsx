import { useEffect, type ReactNode } from "react";
import {
  I18nProvider,
  RootProvider,
  StoreProvider,
  useInsideRoot,
  useResolvedI18n,
  useResolvedStore,
  type I18nSource,
  type StoreSource,
} from "../context";
import { cx } from "../util";
import { ApprovalPrompt } from "./ApprovalPrompt";
import { KlIcon } from "./KlIcon";
import { ToastStack } from "./ToastStack";

export interface ApprovalInboxProps extends StoreSource, I18nSource {
  theme?: "auto" | "light" | "dark";
  /** An item's conversation was opened in the store, for the host to show it. */
  onOpenSession?: (sessionId: string) => void;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  className?: string;
}

const sourceIcons = { schedule: "clock", api: "sparkle", chat: "chat" } as const;

/**
 * The approval inbox: what unattended runs left waiting, across conversations, for the signed-in person to approve,
 * deny with a reason, or edit first. The server lists only what their roles let them decide, oldest first.
 */
export function ApprovalInbox(props: ApprovalInboxProps) {
  const { theme = "auto", onOpenSession, headerStart, headerEnd, className } = props;
  const i18n = useResolvedI18n(props);
  const store = useResolvedStore(props, "ApprovalInbox", i18n.locale);
  const insideRoot = useInsideRoot();
  const { inbox } = store.state;

  // The store keeps it current; catch up in case this shows long after the store loaded.
  useEffect(() => {
    if (store.state.ready) void store.refreshInbox();
  }, [store]);

  function open(sessionId: string) {
    void store.openSession(sessionId);
    onOpenSession?.(sessionId);
  }

  return (
    <StoreProvider value={store}>
      <I18nProvider value={i18n}>
        <RootProvider value={true}>
          <section
            className={cx("kl-inbox", !insideRoot && "kl-root", className)}
            data-kl-theme={insideRoot ? undefined : theme}
            aria-label={i18n.t("inbox.title")}
          >
            <header className="kl-inbox__header">
              {headerStart}
              <h2 className="kl-inbox__title">{i18n.t("inbox.title")}</h2>
              {inbox.length > 0 && <span className="kl-pill kl-tone-warning">{i18n.number(inbox.length)}</span>}
              {headerEnd}
            </header>
            <div className="kl-inbox__body kl-scroll">
              <div className="kl-inbox__list">
                {inbox.length ? (
                  <p className="kl-inbox__intro">{i18n.t("inbox.intro")}</p>
                ) : (
                  <p className="kl-inbox__empty">
                    <KlIcon name="shield" size={22} />
                    {i18n.t("inbox.empty")}
                  </p>
                )}
                {inbox.map((item) => (
                  <article key={item.approval.id} className="kl-inbox__item">
                    <div className="kl-inbox__meta">
                      <button type="button" className="kl-inbox__session" title={i18n.t("inbox.open")} onClick={() => open(item.sessionId)}>
                        <KlIcon name={sourceIcons[item.source]} size={13} />
                        <span>{item.sessionTitle}</span>
                      </button>
                      <span>
                        {i18n.t(`inbox.source.${item.source}`)} · {i18n.timeAgo(item.createdAt)}
                      </span>
                    </div>
                    <ApprovalPrompt approval={item.approval} sessionId={item.sessionId} />
                  </article>
                ))}
              </div>
            </div>
            {/* On its own, it shows why a decision didn't go through; inside the workspace, the workspace does. */}
            {!insideRoot && <ToastStack onOpenSession={onOpenSession} />}
          </section>
        </RootProvider>
      </I18nProvider>
    </StoreProvider>
  );
}
