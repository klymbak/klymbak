import type { ChatMessage } from "@klymbak/protocol";
import { formatTokens } from "@klymbak/client";
import { cx } from "../util";
import { MarkdownContent } from "./MarkdownContent";
import { KlIcon } from "./KlIcon";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";

const ORIGIN: Record<string, string> = {
  steer: "Added while the agent was working",
  hook: "Automatic follow-up",
  schedule: "Scheduled task",
};

export function MessageItem({ message, compact, showMeta }: { message: ChatMessage; compact?: boolean; showMeta?: boolean }) {
  if (message.role === "user") {
    const origin = message.origin ? ORIGIN[message.origin] : undefined;
    return (
      <div className={cx("kl-msg kl-msg--user", compact && "kl-msg--compact")}>
        {origin && (
          <span className="kl-msg__origin">
            <KlIcon name={message.origin === "schedule" ? "clock" : "sparkle"} size={12} /> {origin}
          </span>
        )}
        <div className="kl-msg__bubble">
          {message.parts.map((part, i) =>
            part.type === "text" ? (
              <p key={i} className="kl-msg__text">
                {part.text}
              </p>
            ) : part.type === "image" ? (
              <img key={i} className="kl-msg__image" src={`data:${part.mimeType};base64,${part.data}`} alt="Attached image" />
            ) : null,
          )}
        </div>
      </div>
    );
  }

  if (message.role === "notice") {
    return (
      <div className={`kl-notice kl-notice--${message.level ?? "info"}`} role="status">
        <KlIcon name={message.level === "error" || message.level === "warning" ? "alert" : "info"} size={14} />
        <span>{message.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</span>
      </div>
    );
  }

  const streaming = message.status === "streaming";
  const lastIndex = message.parts.length - 1;
  const isFinalAnswer = !message.parts.some((p) => p.type === "tool");
  const hasContent = message.parts.some((p) => (p.type === "text" ? p.text.trim() : true));

  return (
    <div className={cx("kl-msg kl-msg--assistant", compact && "kl-msg--compact")}>
      {message.parts.map((part, i) => {
        if (part.type === "thinking") return <ThinkingBlock key={i} text={part.text} redacted={part.redacted} active={streaming && i === lastIndex} />;
        if (part.type === "text" && part.text.trim()) return <MarkdownContent key={i} source={part.text} streaming={streaming && i === lastIndex} />;
        if (part.type === "tool") return <ToolCallCard key={i} part={part} compact={compact} />;
        return null;
      })}
      {streaming && !hasContent && (
        <div className="kl-msg__waiting">
          <span className="kl-spinner" /> Working…
        </div>
      )}
      {message.status === "error" && message.error && (
        <div className="kl-notice kl-notice--error">
          <KlIcon name="alert" size={14} /> <span>{message.error}</span>
        </div>
      )}
      {message.status === "aborted" ? (
        <div className="kl-msg__meta">Stopped</div>
      ) : (
        showMeta &&
        isFinalAnswer &&
        message.status === "done" &&
        message.usage && (
          <div className="kl-msg__meta kl-num">
            {message.model?.id} · {formatTokens(message.usage.totalTokens)} tokens
            {message.usage.cost ? ` · $${message.usage.cost.toFixed(4)}` : null}
          </div>
        )
      )}
    </div>
  );
}
