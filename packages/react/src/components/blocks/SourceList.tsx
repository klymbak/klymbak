import { useState } from "react";
import type { SourceItem, SourcesBlock } from "@klymbak/protocol";
import { safeUrl } from "@klymbak/client";
import { useI18n } from "../../context";
import { cx } from "../../util";
import { KlIcon } from "../KlIcon";

const PAGE = 4;
/** Excerpts longer than this show three lines until opened. */
const LONG_EXCERPT = 300;

export function SourceList({ block }: { block: SourcesBlock }) {
  const i18n = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());

  const visible = expanded ? block.items : block.items.slice(0, PAGE);
  const hidden = block.items.length - visible.length;
  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });

  function name(item: SourceItem) {
    const url = safeUrl(item.url);
    return url ? (
      <a className="kl-sources__name" href={url} target="_blank" rel="noopener noreferrer" aria-label={i18n.t("sources.open", { title: item.title })}>
        {item.title}
        <KlIcon name="external" size={12} />
      </a>
    ) : (
      <span className="kl-sources__name">{item.title}</span>
    );
  }

  return (
    <section className="kl-sources">
      <div className="kl-sources__bar">
        <KlIcon name="file" size={14} />
        <span className="kl-sources__title">{block.title ?? i18n.t("sources.title")}</span>
        {block.items.length > 1 && <span className="kl-sources__count kl-num">{i18n.t("sources.count", { count: block.items.length })}</span>}
      </div>
      <ol className="kl-sources__list">
        {visible.map((item, i) => {
          const where = [item.source, item.location].filter(Boolean).join(" · ");
          const long = (item.excerpt?.length ?? 0) > LONG_EXCERPT;
          return (
            <li key={`${i}:${item.url ?? item.title}`} className="kl-sources__item">
              <span className="kl-sources__n kl-num">{i + 1}</span>
              {name(item)}
              {where && <span className="kl-sources__where">{where}</span>}
              {item.excerpt && <p className={cx("kl-sources__excerpt", long && !open.has(i) && "kl-sources__excerpt--clamped")}>{item.excerpt}</p>}
              {long && (
                <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm kl-sources__toggle" aria-expanded={open.has(i)} onClick={() => toggle(i)}>
                  {i18n.t(open.has(i) ? "sources.collapse" : "sources.expand")}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {(hidden > 0 || (expanded && block.items.length > PAGE)) && (
        <div className="kl-sources__foot">
          <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm" onClick={() => setExpanded(hidden > 0)}>
            {hidden > 0 ? i18n.t("common.showMore", { count: hidden }) : i18n.t("common.showFewer")}
          </button>
        </div>
      )}
    </section>
  );
}
