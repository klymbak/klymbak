import type { ChatMessage } from "@klymbak/protocol";
import { formatTokens, referenceParts, referenceView } from "@klymbak/client";
import { useI18n } from "../context";
import { cx } from "../util";
import { MarkdownContent } from "./MarkdownContent";
import { KlIcon } from "./KlIcon";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallCard } from "./ToolCallCard";

const ORIGIN = { steer: "message.origin.steer", hook: "message.origin.hook", schedule: "message.origin.schedule" } as const;

export function MessageItem({ message, compact, showMeta }: { message: ChatMessage; compact?: boolean; showMeta?: boolean }) {
  const i18n = useI18n();
  if (message.role === "user") {
    const origin = message.origin && message.origin !== "user" ? i18n.t(ORIGIN[message.origin]) : undefined;
    const references = referenceParts(message.parts).map(referenceView);
    return (
      <div className={cx("kl-msg kl-msg--user", compact && "kl-msg--compact")}>
        {origin && (
          <span className="kl-msg__origin">
            <KlIcon name={message.origin === "schedule" ? "clock" : "sparkle"} size={12} /> {origin}
          </span>
        )}
        <div className="kl-msg__bubble">
          {references.length > 0 && (
            <div className="kl-msg__refs">
              {references.map((reference, i) => (
                <span key={i} className={cx("kl-ref", reference.icon === "chat" && "kl-ref--prompt")} title={reference.title}>
                  <KlIcon name={reference.icon} size={12} />
                  <span className="kl-ref__name">{reference.name}</span>
                  {reference.detail && <span className="kl-ref__detail">{reference.detail}</span>}
                </span>
              ))}
            </div>
          )}
          {message.parts.map((part, i) =>
            part.type === "text" ? (
              <p key={i} className="kl-msg__text">
                {part.text}
              </p>
            ) : part.type === "image" ? (
              <img key={i} className="kl-msg__image" src={`data:${part.mimeType};base64,${part.data}`} alt={i18n.t("message.attachedImage")} />
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
          <span className="kl-spinner" /> {i18n.t("message.working")}
        </div>
      )}
      {message.status === "error" && message.error && (
        <div className="kl-notice kl-notice--error">
          <KlIcon name="alert" size={14} /> <span>{message.error}</span>
        </div>
      )}
      {message.status === "aborted" ? (
        <div className="kl-msg__meta">{i18n.t("message.stopped")}</div>
      ) : (
        showMeta &&
        isFinalAnswer &&
        message.status === "done" &&
        message.usage && (
          <div className="kl-msg__meta kl-num">
            {message.model?.id} · {i18n.t("message.tokens", { count: message.usage.totalTokens ?? 0, tokens: formatTokens(message.usage.totalTokens) })}
            {message.usage.cost ? ` · $${message.usage.cost.toFixed(4)}` : null}
          </div>
        )
      )}
    </div>
  );
}
