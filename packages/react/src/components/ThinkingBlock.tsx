import { useState } from "react";
import { useI18n } from "../context";
import { cx } from "../util";
import { KlIcon } from "./KlIcon";

export function ThinkingBlock({ text, active, redacted }: { text: string; active?: boolean; redacted?: boolean }) {
  const i18n = useI18n();
  const [open, setOpen] = useState(false);
  if (!text.trim() && !redacted && !active) return null;
  return (
    <div className="kl-think">
      <button type="button" className="kl-think__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <KlIcon name="brain" size={14} />
        <span>{i18n.t(active ? "thinking.active" : "thinking.done")}</span>
        {active && (
          <span className="kl-think__dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <KlIcon name={open ? "chevronDown" : "chevron"} size={12} />
      </button>
      {(open || (active && text)) && (
        <p className={cx("kl-think__text", active && !open && "kl-think__text--live")}>
          {redacted ? i18n.t("thinking.redacted") : text.trim()}
        </p>
      )}
    </div>
  );
}
