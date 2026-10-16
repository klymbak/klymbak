import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage } from "@klymbak/protocol";
import { useOptionalAgentStore } from "../context";
import { MessageItem } from "./MessageItem";
import { KlIcon } from "./KlIcon";

/**
 * Messages are mutated in place while they stream, so a row re-renders when its message's revision in the
 * store changes (or the message is replaced), not on every change to the conversation.
 */
const MessageRow = memo(function MessageRow({ message, showMeta }: { message: ChatMessage; showMeta?: boolean; revision: number }) {
  return <MessageItem message={message} showMeta={showMeta} />;
});

/** Changes whenever the visible tail of the conversation grows. Cheap to compute on every delta. */
function tailSignature(messages: readonly ChatMessage[]) {
  const last = messages[messages.length - 1];
  const part = last?.parts[last.parts.length - 1];
  let size = 0;
  if (part?.type === "text" || part?.type === "thinking") size = part.text.length;
  else if (part?.type === "tool") size = part.status.length * 1000 + (part.result ? 1 : 0) + (part.subagent?.messages.length ?? 0) * 10;
  return `${messages.length}:${last?.parts.length}:${size}`;
}

export function MessageList({
  messages,
  running,
  showMeta,
  empty,
}: {
  messages: readonly ChatMessage[];
  running?: boolean;
  showMeta?: boolean;
  /** Shown when there are no messages yet. */
  empty?: ReactNode;
}) {
  const store = useOptionalAgentStore();
  // Only the store's own transcript has revisions; anything else renders without memoizing.
  const revisionOf = store?.getMessageRevision && messages === store.state.messages ? store.getMessageRevision : undefined;
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);

  function nearBottom() {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  function scrollToBottom(smooth = false) {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    pinnedRef.current = true;
    setPinned(true);
  }

  // Follow the stream while the reader is at the bottom; leave them alone once they scroll up.
  const tail = tailSignature(messages);
  useLayoutEffect(() => {
    if (pinnedRef.current) scrollToBottom();
  }, [tail]);

  // A different conversation (or the first render) starts at the bottom.
  const firstId = messages[0]?.id;
  useLayoutEffect(() => {
    scrollToBottom();
  }, [firstId]);

  return (
    <div
      ref={scroller}
      className="kl-list kl-scroll"
      onScroll={() => {
        pinnedRef.current = nearBottom();
        setPinned(pinnedRef.current);
      }}
    >
      <div className="kl-list__inner">
        {!messages.length && empty}
        {messages.map((message) =>
          revisionOf ? (
            <MessageRow key={message.id} message={message} showMeta={showMeta} revision={revisionOf(message.id)} />
          ) : (
            <MessageItem key={message.id} message={message} showMeta={showMeta} />
          ),
        )}
        <div className="kl-sr-only" aria-live="polite">
          {running ? "The agent is working" : ""}
        </div>
      </div>
      {!pinned && (
        <button type="button" className="kl-list__jump kl-btn kl-btn--sm" onClick={() => scrollToBottom(true)}>
          <KlIcon name="arrowDown" size={12} /> Latest
        </button>
      )}
    </div>
  );
}
