import { useState } from "react";
import { cx } from "../util";
import { KlIcon } from "./KlIcon";

export function ThinkingBlock({ text, active, redacted }: { text: string; active?: boolean; redacted?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim() && !redacted && !active) return null;
  return (
    <div className="kl-think">
      <button type="button" className="kl-think__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <KlIcon name="brain" size={14} />
        <span>{active ? "Thinking" : "Reasoning"}</span>
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
          {redacted ? "The model's reasoning is hidden by the provider." : text.trim()}
        </p>
      )}
    </div>
  );
}
