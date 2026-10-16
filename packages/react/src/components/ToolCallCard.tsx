import { Fragment, useEffect, useState } from "react";
import { humanize, type ToolPart, type ToolStatus } from "@klymbak/protocol";
import { useRenderers } from "../context";
import { cx } from "../util";
import { ApprovalPrompt } from "./ApprovalPrompt";
import { KlIcon } from "./KlIcon";
import { SubagentTrace } from "./SubagentTrace";
import { UiBlockView } from "./blocks/UiBlockView";

const STATUS: Record<ToolStatus, { label: string; tone: string }> = {
  streaming: { label: "Preparing", tone: "neutral" },
  pending: { label: "Queued", tone: "neutral" },
  awaiting_approval: { label: "Waiting for you", tone: "warning" },
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "success" },
  error: { label: "Failed", tone: "danger" },
  denied: { label: "Denied", tone: "danger" },
  blocked: { label: "Blocked", tone: "danger" },
};

const ICONS = { mcp: "plug", builtin: "clock", subagent: "agents", local: "tool" } as const;

export function ToolCallCard({ part, compact }: { part: ToolPart; compact?: boolean }) {
  const renderers = useRenderers();
  const failed = part.status === "error" || part.status === "blocked";
  const [open, setOpen] = useState(failed);
  useEffect(() => {
    if (failed) setOpen(true);
  }, [failed]);

  const status = STATUS[part.status];
  const active = ["streaming", "pending", "running"].includes(part.status);
  const refused = ["error", "denied", "blocked"].includes(part.status);
  const CustomRenderer = renderers.tools?.[part.name];
  const blocks = part.result?.ui ?? [];
  const label = part.label ?? humanize(part.name);

  const args =
    part.args && typeof part.args === "object"
      ? Object.entries(part.args as Record<string, unknown>).map(([key, v]) => ({
          key,
          value: typeof v === "string" ? v : JSON.stringify(v, null, 2),
          long: typeof v === "string" ? v.length > 80 || v.includes("\n") : typeof v === "object",
        }))
      : [];
  // One-line summary of the arguments for the collapsed header.
  const argSummary = args
    .filter((a) => !a.long)
    .slice(0, 3)
    .map((a) => `${humanize(a.key).toLowerCase()}: ${a.value}`)
    .join(" · ");
  const ms = part.durationMs;
  const duration = ms === undefined ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;

  return (
    <div className={cx("kl-tool", `kl-tool--${part.status}`, compact && "kl-tool--compact")}>
      <button type="button" className="kl-tool__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={cx("kl-tool__icon", active && "kl-tool__icon--active")}>
          {active ? <span className="kl-spinner" /> : <KlIcon name={ICONS[part.source ?? "local"]} size={14} />}
        </span>
        <span className="kl-tool__name">{label}</span>
        {part.server && <span className="kl-tool__via">via {part.server}</span>}
        {argSummary && !part.subagent && <span className="kl-tool__args">{argSummary}</span>}
        <span className="kl-tool__meta">
          {duration && <span className="kl-faint kl-num">{duration}</span>}
          <span className={`kl-pill kl-tone-${status.tone}`}>{status.label}</span>
          <KlIcon className={cx("kl-tool__chevron", open && "kl-tool__chevron--open")} name="chevronDown" size={14} />
        </span>
      </button>

      {part.approval && (
        <div className="kl-tool__section">
          <ApprovalPrompt approval={part.approval} />
        </div>
      )}

      {part.progress && active && <div className="kl-tool__progress kl-faint">{part.progress}</div>}

      {refused && part.result && !open && <div className="kl-tool__reason">{part.result.text}</div>}

      {part.subagent && (
        <div className="kl-tool__section">
          <SubagentTrace subagent={part.subagent} result={part.result?.text} done={part.status === "done"} />
        </div>
      )}

      {CustomRenderer && part.result ? (
        <div className="kl-tool__section">
          <CustomRenderer part={part} />
        </div>
      ) : (
        blocks.length > 0 && (
          <div className="kl-tool__blocks">
            {blocks.map((block, i) => (
              <UiBlockView key={i} block={block} />
            ))}
          </div>
        )
      )}

      {open && (
        <div className="kl-tool__details">
          {args.length > 0 && (
            <div className="kl-tool__detail">
              <span className="kl-tool__detail-label">Input</span>
              <dl className="kl-tool__argList">
                {args.map((arg) => (
                  <Fragment key={arg.key}>
                    <dt>{humanize(arg.key)}</dt>
                    <dd className={arg.long ? "kl-tool__argLong" : undefined}>{arg.value}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          )}
          {part.result?.text && !part.subagent && (
            <div className="kl-tool__detail">
              <span className="kl-tool__detail-label">{part.result.isError ? "Error" : "What the agent saw"}</span>
              <pre className="kl-tool__output kl-scroll">{part.result.text}</pre>
            </div>
          )}
          <div className="kl-tool__detail kl-faint kl-tool__ids">
            <span className="kl-code">{part.name}</span>
            {part.source === "mcp" && (
              <span>
                MCP tool from <strong>{part.server}</strong>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
