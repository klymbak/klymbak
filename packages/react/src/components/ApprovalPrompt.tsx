import { useState } from "react";
import type { ApprovalDecision, ApprovalView } from "@klymbak/protocol";
import { useI18n, useOptionalAgentStore } from "../context";
import { cx } from "../util";
import { KlIcon } from "./KlIcon";

const riskTone = { low: "info", medium: "warning", high: "danger" } as const;

export function ApprovalPrompt({ approval, onDecide }: { approval: ApprovalView; onDecide?: (decision: ApprovalDecision) => void }) {
  const store = useOptionalAgentStore();
  const i18n = useI18n();
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
            <span>{i18n.t("approval.needed")}</span>
            {approval.risk && <span className={`kl-pill kl-tone-${riskTone[approval.risk]}`}>{i18n.t(`approval.risk.${approval.risk}`)}</span>}
          </div>
          <p className="kl-approval__title">{approval.title}</p>
          {approval.description && <p className="kl-approval__desc">{approval.description}</p>}
          {denying && (
            <label className="kl-label kl-approval__reason">
              {i18n.t("approval.reasonLabel")}
              <input
                className="kl-input"
                type="text"
                placeholder={i18n.t("approval.reasonPlaceholder")}
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
              <KlIcon name="check" size={14} /> {i18n.t("approval.approve")}
            </button>
            <button type="button" className="kl-btn" disabled={busy} onClick={() => void decide(false)}>
              <KlIcon name="x" size={14} /> {i18n.t(denying ? "approval.confirmDeny" : "approval.deny")}
            </button>
            {approval.rememberable && !denying && (
              <label className="kl-approval__remember">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                {i18n.t("approval.remember")}
              </label>
            )}
          </div>
        </>
      ) : (
        <div className="kl-approval__decided">
          <span className={`kl-stamp kl-stamp--${approval.status}`}>{i18n.t(`approval.status.${approval.status}`)}</span>
          <div className="kl-approval__summary">
            <span className="kl-approval__title">{approval.title}</span>
            <span className="kl-faint">
              {approval.decidedBy && i18n.t("approval.decidedBy", { name: approval.decidedBy })}
              {approval.reason && ` · ${i18n.t("approval.reason", { reason: approval.reason })}`}
              {approval.status === "expired" && i18n.t("approval.expiredNote")}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
