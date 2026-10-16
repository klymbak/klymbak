import type { ActionsBlock, UiAction } from "@klymbak/protocol";
import { useChatActions } from "../../context";
import { KlIcon } from "../KlIcon";

export function ActionBar({ block }: { block: ActionsBlock }) {
  const actions = useChatActions();

  function run(action: UiAction) {
    if (action.kind === "link" && action.href) return;
    if (action.prompt && action.kind !== "event") actions.sendPrompt(action.prompt);
    else actions.emitAction(action);
  }

  return (
    <div className="kl-actions">
      {block.title && <span className="kl-actions__title">{block.title}</span>}
      {block.actions.map((action) =>
        action.kind === "link" && action.href ? (
          <a key={action.label} className="kl-btn kl-btn--sm" href={action.href} target="_blank" rel="noopener noreferrer">
            {action.label} <KlIcon name="external" size={12} />
          </a>
        ) : (
          <button
            key={action.label}
            type="button"
            className={action.tone === "danger" ? "kl-btn kl-btn--sm kl-btn--danger" : "kl-btn kl-btn--sm"}
            onClick={() => run(action)}
          >
            {action.label}
          </button>
        ),
      )}
    </div>
  );
}
