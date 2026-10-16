import type { KeyValueBlock } from "@klymbak/protocol";
import { formatValue, toneClass } from "@klymbak/client";
import { cx, displayText } from "../../util";

export function KeyValueList({ block }: { block: KeyValueBlock }) {
  return (
    <section className="kl-kv">
      {block.title && <h4 className="kl-kv__title">{block.title}</h4>}
      <dl className="kl-kv__list">
        {block.items.map((item) => (
          <div key={item.label} className="kl-kv__row">
            <dt>{item.label}</dt>
            <dd>
              {item.format === "badge" ? (
                <span className={cx("kl-pill", toneClass(item.tone))}>{displayText(item.value)}</span>
              ) : item.format === "code" ? (
                <span className="kl-code">{displayText(item.value)}</span>
              ) : (
                <span className={item.tone ? cx("kl-kv__toned", toneClass(item.tone)) : undefined}>{formatValue(item.value, item.format, item.currency)}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
