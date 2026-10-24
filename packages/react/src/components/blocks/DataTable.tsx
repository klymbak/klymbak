import { useEffect, useMemo, useState } from "react";
import type { TableBlock, TableColumn } from "@klymbak/protocol";
import { fillTemplate, toneClass } from "@klymbak/client";
import { cx, displayText } from "../../util";
import { useChatActions, useI18n } from "../../context";
import { KlIcon } from "../KlIcon";

const PAGE = 10;

const numeric = (column: TableColumn) => ["number", "integer", "currency", "percent"].includes(column.format ?? "");
const align = (column: TableColumn) => column.align ?? (numeric(column) ? "right" : "left");

export function DataTable({ block }: { block: TableBlock }) {
  const actions = useChatActions();
  const i18n = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [copied, setCopied] = useState(false);

  const sorted = useMemo(() => {
    const rows = [...block.rows];
    if (!sortKey) return rows;
    return rows.sort((a, b) => {
      const x = a[sortKey];
      const y = b[sortKey];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sortDir;
    });
  }, [block.rows, sortKey, sortDir]);

  const visible = expanded ? sorted : sorted.slice(0, PAGE);
  const hidden = block.rows.length - visible.length;
  const total = block.totalRows ?? block.rows.length;
  const hasRowActions = Boolean(block.rowActions?.length);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  function sortBy(column: TableColumn) {
    if (sortKey === column.key) {
      if (sortDir === 1) setSortDir(-1);
      else setSortKey(null);
    } else {
      setSortKey(column.key);
      setSortDir(numeric(column) ? -1 : 1);
    }
  }

  async function copyCsv() {
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [
      block.columns.map((c) => escape(c.label)).join(","),
      ...sorted.map((row) => block.columns.map((c) => escape(row[c.key])).join(",")),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
    } catch {
      // Clipboard access can be refused; nothing else to do.
    }
  }

  function cell(row: Record<string, unknown>, column: TableColumn) {
    const value = row[column.key];
    if (column.format === "badge" && value != null) {
      return <span className={cx("kl-pill", toneClass(column.tones?.[String(value)]))}>{displayText(value)}</span>;
    }
    if (column.format === "code") {
      return <span className="kl-code">{column.key === "id" && typeof value === "number" ? `#${value}` : displayText(value)}</span>;
    }
    if (column.format === "email") return <span className="kl-table__email">{displayText(value)}</span>;
    return i18n.formatValue(value, column.format, column.currency);
  }

  return (
    <div className="kl-table">
      {(block.title || block.rows.length > 0) && (
        <div className="kl-table__bar">
          <span className="kl-table__title">{block.title}</span>
          <span className="kl-table__count kl-num">{i18n.t("table.rows", { count: total })}</span>
          <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm" title={i18n.t("table.copyCsv")} onClick={copyCsv}>
            <KlIcon name={copied ? "check" : "copy"} size={14} />
            {i18n.t(copied ? "table.copied" : "table.csv")}
          </button>
        </div>
      )}
      <div className="kl-table__scroll kl-scroll">
        <table>
          <thead>
            <tr>
              {block.columns.map((column) => (
                <th
                  key={column.key}
                  style={{ textAlign: align(column) }}
                  aria-sort={sortKey === column.key ? (sortDir === 1 ? "ascending" : "descending") : "none"}
                >
                  <button type="button" className="kl-table__sort" onClick={() => sortBy(column)}>
                    {column.label}
                    {sortKey === column.key && <KlIcon name={sortDir === 1 ? "arrowUp" : "arrowDown"} size={12} />}
                  </button>
                </th>
              ))}
              {hasRowActions && (
                <th className="kl-table__actions-head">
                  <span className="kl-sr-only">{i18n.t("table.actions")}</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={block.rowKey ? String(row[block.rowKey]) : i}>
                {block.columns.map((column) => (
                  <td key={column.key} style={{ textAlign: align(column) }} className={numeric(column) ? "kl-num" : undefined}>
                    {cell(row, column)}
                  </td>
                ))}
                {hasRowActions && (
                  <td className="kl-table__row-actions">
                    {block.rowActions!.map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        className="kl-btn kl-btn--sm"
                        onClick={() =>
                          action.prompt ? actions.sendPrompt(fillTemplate(action.prompt, row)) : actions.emitAction({ ...action, payload: row })
                        }
                      >
                        {action.label}
                      </button>
                    ))}
                  </td>
                )}
              </tr>
            ))}
            {!block.rows.length && (
              <tr>
                <td colSpan={block.columns.length + (hasRowActions ? 1 : 0)} className="kl-table__empty">
                  {i18n.t("table.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {(hidden > 0 || expanded || block.caption || total > block.rows.length) && (
        <div className="kl-table__foot">
          {hidden > 0 ? (
            <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm" onClick={() => setExpanded(true)}>
              {i18n.t("common.showMore", { count: hidden })}
            </button>
          ) : (
            expanded &&
            block.rows.length > PAGE && (
              <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm" onClick={() => setExpanded(false)}>
                {i18n.t("common.showFewer")}
              </button>
            )
          )}
          {total > block.rows.length && <span className="kl-faint">{i18n.t("common.showingOf", { shown: block.rows.length, total })}</span>}
          {block.caption && <span className="kl-faint kl-table__caption">{block.caption}</span>}
        </div>
      )}
    </div>
  );
}
