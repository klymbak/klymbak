import { Component, booleanAttribute, input } from "@angular/core";
import type { ChatMessage, ImagePart } from "@klymbak/protocol";
import { formatTokens } from "@klymbak/client";
import { KlIcon } from "./KlIcon.ts";
import { MarkdownContent } from "./MarkdownContent.ts";
import { ThinkingBlock } from "./ThinkingBlock.ts";
import { ToolCallCard } from "./ToolCallCard.ts";

const ORIGIN: Record<string, string> = {
  steer: "Added while the agent was working",
  hook: "Automatic follow-up",
  schedule: "Scheduled task",
};

// Default change detection: a streaming message is updated in place, so the item renders whenever its parent
// does. MessageList narrows that down to the message whose revision in the store changed.
@Component({
  selector: "kl-message-item",
  imports: [KlIcon, MarkdownContent, ThinkingBlock, ToolCallCard],
  host: { style: "display: contents" },
  template: `
    @let m = message();
    @if (m.role === "user") {
      <div class="kl-msg kl-msg--user" [class.kl-msg--compact]="compact()">
        @if (m.origin && ORIGIN[m.origin]) {
          <span class="kl-msg__origin"><svg klIcon [name]="m.origin === 'schedule' ? 'clock' : 'sparkle'" [size]="12" /> {{ ORIGIN[m.origin] }}</span>
        }
        <div class="kl-msg__bubble">
          @for (part of m.parts; track $index) {
            @if (part.type === "text") {
              <p class="kl-msg__text">{{ part.text }}</p>
            } @else if (part.type === "image") {
              <img class="kl-msg__image" [src]="imageUrl(part)" alt="Attached image" />
            }
          }
        </div>
      </div>
    } @else if (m.role === "notice") {
      <div class="kl-notice kl-notice--{{ m.level ?? 'info' }}" role="status">
        <svg klIcon [name]="m.level === 'error' || m.level === 'warning' ? 'alert' : 'info'" [size]="14" />
        <span>{{ noticeText() }}</span>
      </div>
    } @else {
      @let streaming = m.status === "streaming";
      <div class="kl-msg kl-msg--assistant" [class.kl-msg--compact]="compact()">
        @for (part of m.parts; track $index; let last = $last) {
          @if (part.type === "thinking") {
            <kl-thinking-block [text]="part.text" [redacted]="part.redacted ?? false" [active]="streaming && last" />
          } @else if (part.type === "text") {
            @if (part.text.trim()) {
              <kl-markdown-content [source]="part.text" [streaming]="streaming && last" />
            }
          } @else if (part.type === "tool") {
            <kl-tool-call-card [part]="part" [compact]="compact()" />
          }
        }
        @if (streaming && !hasContent()) {
          <div class="kl-msg__waiting"><span class="kl-spinner"></span> Working…</div>
        }
        @if (m.status === "error" && m.error) {
          <div class="kl-notice kl-notice--error"><svg klIcon name="alert" [size]="14" /> <span>{{ m.error }}</span></div>
        }
        @if (m.status === "aborted") {
          <div class="kl-msg__meta">Stopped</div>
        } @else if (showMeta() && isFinalAnswer() && m.status === "done" && m.usage) {
          <div class="kl-msg__meta kl-num">{{ m.model?.id }} · {{ formatTokens(m.usage.totalTokens) }} tokens{{ m.usage.cost ? " · $" + m.usage.cost.toFixed(4) : "" }}</div>
        }
      </div>
    }
  `,
})
export class MessageItem {
  readonly message = input.required<ChatMessage>();
  readonly compact = input(false, { transform: booleanAttribute });
  readonly showMeta = input(false, { transform: booleanAttribute });
  protected readonly ORIGIN = ORIGIN;
  protected readonly formatTokens = formatTokens;

  protected imageUrl(part: ImagePart) {
    return `data:${part.mimeType};base64,${part.data}`;
  }

  protected noticeText() {
    return this.message()
      .parts.map((p) => (p.type === "text" ? p.text : ""))
      .join("");
  }

  protected hasContent() {
    return this.message().parts.some((p) => (p.type === "text" ? p.text.trim() : true));
  }

  protected isFinalAnswer() {
    return !this.message().parts.some((p) => p.type === "tool");
  }
}
