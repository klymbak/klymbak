import { useState } from "react";
import type { ApprovalDecision, ApprovalView } from "@klymbak/protocol";
import { useOptionalAgentStore } from "../context";
import { cx } from "../util";
import { KlIcon } from "./KlIcon";

const riskTone = { low: "info", medium: "warning", high: "danger" } as const;

export function ApprovalPrompt({ approval, onDecide }: { approval: ApprovalView; onDecide?: (decision: ApprovalDecision) => void }) {
  const store = useOptionalAgentStore();
  const [remember, setRemember] = useState(false);
  const [reason, setReason] = useState("");
  const [denying, setDenying] = useState(false);
  const [busy, setBusy] = useState(false);

  async function decide(approved: boolean) {
    if (!approved && !denying) {
      setDenying(true);
      return;
    }
    setBusy(true);
    const decision = { approved, reason: reason.trim() || undefined, remember: approved && remember };
    onDecide?.(decision);
    try {
      await store?.decide(approval.id, decision);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cx("kl-approval", `kl-approval--${approval.status}`, `kl-tone-${riskTone[approval.risk ?? "medium"]}`)}>
      {approval.status === "pending" ? (
        <>
          <div className="kl-approval__head">
            <KlIcon name="shield" size={15} />
            <span>Needs your approval</span>
            {approval.risk && <span className={`kl-pill kl-tone-${riskTone[approval.risk]}`}>{approval.risk} risk</span>}
          </div>
          <p className="kl-approval__title">{approval.title}</p>
          {approval.description && <p className="kl-approval__desc">{approval.description}</p>}
          {denying && (
            <label className="kl-label kl-approval__reason">
              Why not? (optional, the agent will read this)
              <input
                className="kl-input"
                type="text"
                placeholder="e.g. Offer a replacement instead"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void decide(false);
                }}
              />
            </label>
          )}
          <div className="kl-approval__buttons">
            <button type="button" className="kl-btn kl-btn--primary" disabled={busy} onClick={() => void decide(true)}>
              <KlIcon name="check" size={14} /> Approve
            </button>
            <button type="button" className="kl-btn" disabled={busy} onClick={() => void decide(false)}>
              <KlIcon name="x" size={14} /> {denying ? "Confirm deny" : "Deny"}
            </button>
            {approval.rememberable && !denying && (
              <label className="kl-approval__remember">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                Don't ask again in this chat
              </label>
            )}
          </div>
        </>
      ) : (
        <div className="kl-approval__decided">
          <span className={`kl-stamp kl-stamp--${approval.status}`}>{approval.status}</span>
          <div className="kl-approval__summary">
            <span className="kl-approval__title">{approval.title}</span>
            <span className="kl-faint">
              {approval.decidedBy && `by ${approval.decidedBy}`}
              {approval.reason && ` · “${approval.reason}”`}
              {approval.status === "expired" && "Nobody decided in time"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
