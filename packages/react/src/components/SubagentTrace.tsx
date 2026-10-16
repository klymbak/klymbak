import { useEffect, useState } from "react";
import type { SubagentView } from "@klymbak/protocol";
import { MarkdownContent } from "./MarkdownContent";
import { MessageItem } from "./MessageItem";
import { KlIcon } from "./KlIcon";

export function SubagentTrace({ subagent, result, done }: { subagent: SubagentView; result?: string; done?: boolean }) {
  const steps = subagent.messages.reduce((count, m) => count + m.parts.filter((p) => p.type === "tool").length, 0);
  const [showSteps, setShowSteps] = useState(subagent.status === "running");
  useEffect(() => {
    if (subagent.status !== "running") setShowSteps(false);
  }, [subagent.status]);

  return (
    <div className="kl-sub">
      <div className="kl-sub__head">
        <span className="kl-sub__agent">
          <KlIcon name="agents" size={14} /> {subagent.agent}
        </span>
        {subagent.status === "running" && (
          <span className="kl-sub__status kl-faint">
            <span className="kl-spinner" /> working
          </span>
        )}
        {subagent.messages.length > 0 && (
          <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm" onClick={() => setShowSteps(!showSteps)}>
            {showSteps ? "Hide" : "Show"} {steps} {steps === 1 ? "step" : "steps"}
            <KlIcon name={showSteps ? "chevronDown" : "chevron"} size={12} />
          </button>
        )}
      </div>
      <p className="kl-sub__task">{subagent.task}</p>
      {showSteps && (
        <div className="kl-sub__steps">
          {subagent.messages.map((message) => (
            <MessageItem key={message.id} message={message} compact />
          ))}
        </div>
      )}
      {done && result && (
        <div className="kl-sub__result">
          <span className="kl-sub__result-label">Answer</span>
          <MarkdownContent source={result} />
        </div>
      )}
    </div>
  );
}
