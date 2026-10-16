import { useState } from "react";
import { mediaKind, type MediaBlock, type MediaItem } from "@klymbak/protocol";
import { mediaMeta, mediaName, mediaType, safeUrl } from "@klymbak/client";
import { cx } from "../../util";
import { KlIcon } from "../KlIcon";

const PAGE = 12;

export function MediaGallery({ block }: { block: MediaBlock }) {
  const [expanded, setExpanded] = useState(false);
  // A file whose preview fails to load (deleted, or a path this page can't reach) shows as a file tile.
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());

  const visible = expanded ? block.items : block.items.slice(0, PAGE);
  const hidden = block.items.length - visible.length;
  const total = block.totalItems ?? block.items.length;
  const fail = (url: string) => setBroken((current) => new Set(current).add(url));

  function preview(item: MediaItem, name: string) {
    const url = safeUrl(item.url);
    const kind = url && !broken.has(url) ? mediaKind(item) : "file";
    if (kind === "video") {
      return (
        <div className="kl-media__preview">
          <video src={url} controls muted playsInline preload="metadata" onError={() => fail(url!)} />
        </div>
      );
    }
    const content =
      kind === "image" ? (
        <img src={url} alt={item.alt ?? ""} loading="lazy" decoding="async" onError={() => fail(url!)} />
      ) : (
        <span className="kl-media__file">
          <KlIcon name="file" size={28} />
          {mediaType(item) ?? "File"}
        </span>
      );
    return url ? (
      <a className="kl-media__preview" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name}`}>
        {content}
      </a>
    ) : (
      <div className="kl-media__preview">{content}</div>
    );
  }

  return (
    <div className={cx("kl-media", block.items.length === 1 && "kl-media--single")}>
      {(block.title || block.items.length > 1) && (
        <div className="kl-media__bar">
          <span className="kl-media__title">{block.title}</span>
          <span className="kl-media__count kl-num">
            {total.toLocaleString()} {total === 1 ? "file" : "files"}
          </span>
        </div>
      )}
      <ul className="kl-media__grid">
        {visible.map((item, i) => {
          const name = mediaName(item);
          const meta = mediaMeta(item);
          return (
            <li key={`${i}:${item.url}`}>
              <figure className="kl-media__item">
                {preview(item, name)}
                <figcaption>
                  <span className="kl-media__name" title={name}>
                    {name}
                  </span>
                  {meta && <span className="kl-media__meta kl-num">{meta}</span>}
                  {item.caption && (
                    <span className="kl-media__caption" title={item.caption}>
                      {item.caption}
                    </span>
                  )}
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
      {(hidden > 0 || expanded || block.caption || total > block.items.length) && (
        <div className="kl-media__foot">
          {hidden > 0 ? (
            <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm" onClick={() => setExpanded(true)}>
              Show {hidden} more
            </button>
          ) : (
            expanded &&
            block.items.length > PAGE && (
              <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm" onClick={() => setExpanded(false)}>
                Show fewer
              </button>
            )
          )}
          {total > block.items.length && (
            <span className="kl-faint">
              Showing {block.items.length} of {total.toLocaleString()}
            </span>
          )}
          {block.caption && <span className="kl-faint kl-media__foot-caption">{block.caption}</span>}
        </div>
      )}
    </div>
  );
}
