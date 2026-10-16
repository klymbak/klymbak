import type { StatItem, StatsBlock } from "@klymbak/protocol";
import { formatValue, toneClass } from "@klymbak/client";
import { cx } from "../../util";
import { KlIcon } from "../KlIcon";

function deltaTone(item: StatItem) {
  if (item.delta === undefined || item.delta === 0) return "neutral";
  const good = item.invertDelta ? item.delta < 0 : item.delta > 0;
  return good ? "success" : "danger";
}

function deltaText(delta: number) {
  return `${Math.abs(delta * 100).toFixed(Math.abs(delta) < 0.1 ? 1 : 0)}%`;
}

export function StatGrid({ block }: { block: StatsBlock }) {
  return (
    <section className="kl-stats">
      {block.title && <h4 className="kl-stats__title">{block.title}</h4>}
      <div className="kl-stats__grid">
        {block.items.map((item) => (
          <div key={item.label} className={cx("kl-stat", item.tone && toneClass(item.tone))}>
            <span className="kl-stat__label">{item.label}</span>
            <span className="kl-stat__value kl-num">
              {typeof item.value === "number" ? formatValue(item.value, item.format, item.currency) : item.value}
            </span>
            {item.delta !== undefined && (
              <span className={cx("kl-stat__delta kl-num", toneClass(deltaTone(item)))}>
                <KlIcon name={item.delta >= 0 ? "arrowUp" : "arrowDown"} size={12} /> {deltaText(item.delta)}
                {item.deltaLabel && <span className="kl-stat__delta-label">{item.deltaLabel}</span>}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
