import { useEffect, useRef, useState } from "react";
import type { SessionSummary } from "@klymbak/protocol";
import { useAgentStore, useI18n } from "../context";
import { cx } from "../util";
import { KlIcon } from "./KlIcon";

const DAY = 86_400_000;

export function SessionList({ onOpen }: { onOpen?: (id: string) => void }) {
  const store = useAgentStore();
  const i18n = useI18n();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  // Read at call time: the blur that follows Enter or Escape must see that renaming already ended.
  const editing = useRef<string | null>(null);
  const { sessions, sessionId } = store.state;

  useEffect(() => {
    if (renaming) renameInput.current?.select();
  }, [renaming]);

  const q = query.trim().toLowerCase();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();
  const buckets: { label: string; items: SessionSummary[] }[] = [
    { label: i18n.t("sessions.today"), items: [] },
    { label: i18n.t("sessions.yesterday"), items: [] },
    { label: i18n.t("sessions.previous7Days"), items: [] },
    { label: i18n.t("sessions.older"), items: [] },
  ];
  for (const session of sessions) {
    if (q && !`${session.title} ${session.preview ?? ""}`.toLowerCase().includes(q)) continue;
    const t = session.updatedAt;
    const bucket = t >= today ? 0 : t >= today - DAY ? 1 : t >= today - 7 * DAY ? 2 : 3;
    buckets[bucket]!.items.push(session);
  }
  const groups = buckets.filter((b) => b.items.length);

  function open(id: string) {
    if (renaming) return;
    void store.openSession(id);
    onOpen?.(id);
  }

  function startRename(session: SessionSummary) {
    editing.current = session.id;
    setRenaming(session.id);
    setDraft(session.title);
  }

  function stopRename() {
    editing.current = null;
    setRenaming(null);
  }

  function commitRename() {
    const id = editing.current;
    stopRename();
    if (id && draft.trim()) void store.renameSession(id, draft.trim());
  }

  return (
    <div className="kl-sessions">
      <button
        type="button"
        className="kl-btn kl-sessions__new"
        onClick={() => {
          store.newSession();
          onOpen?.("");
        }}
      >
        <KlIcon name="plus" size={14} /> {i18n.t("sessions.new")}
      </button>
      {sessions.length > 8 && (
        <input
          className="kl-input"
          type="search"
          placeholder={i18n.t("sessions.search")}
          aria-label={i18n.t("sessions.search")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {!sessions.length && <p className="kl-sessions__empty">{i18n.t("sessions.empty")}</p>}
      {groups.map((group) => (
        <nav key={group.label} className="kl-sessions__group" aria-label={group.label}>
          <span className="kl-sessions__label">{group.label}</span>
          {group.items.map((session) => (
            <div key={session.id} className={cx("kl-session", session.id === sessionId && "kl-session--active")}>
              {renaming === session.id ? (
                <input
                  ref={renameInput}
                  className="kl-input kl-session__rename"
                  aria-label={i18n.t("sessions.titleLabel")}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename();
                    else if (event.key === "Escape") stopRename();
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <button type="button" className="kl-session__open" title={session.title} onClick={() => open(session.id)}>
                  {session.running ? (
                    <span className="kl-spinner kl-session__icon" />
                  ) : (
                    session.source === "schedule" && <KlIcon className="kl-session__icon" name="clock" size={13} />
                  )}
                  <span className="kl-session__title">{session.title}</span>
                  {session.unread && <span className="kl-session__unread" aria-label={i18n.t("sessions.unread")} />}
                </button>
              )}
              {confirming === session.id ? (
                <span className="kl-session__confirm">
                  <button
                    type="button"
                    className="kl-btn kl-btn--sm kl-btn--danger"
                    onClick={() => {
                      void store.deleteSession(session.id);
                      setConfirming(null);
                    }}
                  >
                    {i18n.t("common.delete")}
                  </button>
                  <button type="button" className="kl-btn kl-btn--sm kl-btn--ghost" onClick={() => setConfirming(null)}>
                    {i18n.t("sessions.keep")}
                  </button>
                </span>
              ) : (
                renaming !== session.id && (
                  <span className="kl-session__tools">
                    <button
                      type="button"
                      className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
                      aria-label={i18n.t("sessions.rename")}
                      onClick={() => startRename(session)}
                    >
                      <KlIcon name="edit" size={13} />
                    </button>
                    <button
                      type="button"
                      className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
                      aria-label={i18n.t("common.delete")}
                      onClick={() => setConfirming(session.id)}
                    >
                      <KlIcon name="trash" size={13} />
                    </button>
                  </span>
                )
              )}
            </div>
          ))}
        </nav>
      ))}
    </div>
  );
}
