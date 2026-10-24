import { useEffect, useRef, useState } from "react";
import type { Toast } from "@klymbak/client";
import { useAgentStore, useI18n } from "../context";
import { useTransition } from "../transition";
import { KlIcon } from "./KlIcon";

const icons = { success: "check", danger: "alert", warning: "bell", info: "info" } as const;

function ToastItem({ toast, leaving, onOpen, onDismiss, onLeft }: { toast: Toast; leaving: boolean; onOpen: () => void; onDismiss: () => void; onLeft: () => void }) {
  const i18n = useI18n();
  const el = useRef<HTMLDivElement>(null);
  const visible = useTransition(el, !leaving, "kl-toast", true);
  useEffect(() => {
    if (!visible) onLeft();
  }, [visible, onLeft]);
  return (
    <div ref={el} className={`kl-toast kl-tone-${toast.tone}`} role="status">
      <KlIcon name={icons[toast.tone]} size={16} className="kl-toast__icon" />
      <div className="kl-toast__body">
        <strong>{i18n.text(toast.title)}</strong>
        {toast.body && <p>{i18n.text(toast.body)}</p>}
        {toast.sessionId && (
          <button type="button" className="kl-btn kl-btn--sm" onClick={onOpen}>
            {i18n.t("toast.open")}
          </button>
        )}
      </div>
      <button type="button" className="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" aria-label={i18n.t("common.dismiss")} onClick={onDismiss}>
        <KlIcon name="close" size={12} />
      </button>
    </div>
  );
}

export function ToastStack({ onOpenSession }: { onOpenSession?: (sessionId: string) => void }) {
  const store = useAgentStore();
  const current = store.state.toasts;
  // Toasts the store has dropped stay mounted, in place, until they have animated out. Noticed during
  // render (not in an effect) so the toast is never unmounted in between.
  const [leaving, setLeaving] = useState<Toast[]>([]);
  const [previous, setPrevious] = useState<Toast[]>([]);
  if (current.length !== previous.length || current.some((t, i) => t.id !== previous[i]?.id)) {
    const ids = new Set(current.map((t) => t.id));
    const gone = previous.filter((t) => !ids.has(t.id));
    setPrevious([...current]);
    // Idempotent, since StrictMode may apply render-phase updates twice.
    if (gone.length) setLeaving((list) => [...list, ...gone.filter((t) => !list.some((l) => l.id === t.id))]);
  }
  const finished = useRef(new Map<number, () => void>());
  const onLeft = (id: number) => {
    let callback = finished.current.get(id);
    if (!callback) {
      callback = () => {
        finished.current.delete(id);
        setLeaving((list) => list.filter((t) => t.id !== id));
      };
      finished.current.set(id, callback);
    }
    return callback;
  };

  function open(toast: Toast) {
    if (!toast.sessionId) return;
    void store.openSession(toast.sessionId);
    onOpenSession?.(toast.sessionId);
    store.dismissToast(toast.id);
  }

  const leavingIds = new Set(leaving.map((t) => t.id));
  const shown = [...current.filter((t) => !leavingIds.has(t.id)), ...leaving].sort((a, b) => a.id - b.id);

  return (
    <div className="kl-toasts" aria-live="polite">
      {shown.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          leaving={leavingIds.has(toast.id)}
          onOpen={() => open(toast)}
          onDismiss={() => store.dismissToast(toast.id)}
          onLeft={onLeft(toast.id)}
        />
      ))}
    </div>
  );
}
