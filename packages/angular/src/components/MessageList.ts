import { ChangeDetectionStrategy, Component, ElementRef, afterEveryRender, booleanAttribute, input, signal, viewChild } from "@angular/core";
import type { ChatMessage } from "@klymbak/protocol";
import { agentState, injectI18n, injectOptionalStoreRef } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";
import { MessageItem } from "./MessageItem.ts";

/**
 * Messages are mutated in place while they stream, so a row renders again when its message's revision in the
 * store changes (or the message is replaced), not on every change to the conversation.
 */
@Component({
  selector: "kl-message-row",
  imports: [MessageItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `<kl-message-item [message]="message()" [showMeta]="showMeta()" />`,
})
export class MessageRow {
  readonly message = input.required<ChatMessage>();
  readonly showMeta = input(false);
  /** Not read: a new value is what makes the row render again. */
  readonly revision = input(0);
}

/** Changes whenever the visible tail of the conversation grows. Cheap to compute on every delta. */
function tailSignature(messages: readonly ChatMessage[]) {
  const last = messages[messages.length - 1];
  const part = last?.parts[last.parts.length - 1];
  let size = 0;
  if (part?.type === "text" || part?.type === "thinking") size = part.text.length;
  else if (part?.type === "tool") size = part.status.length * 1000 + (part.result ? 1 : 0) + (part.subagent?.messages.length ?? 0) * 10;
  return `${messages.length}:${last?.parts.length}:${size}`;
}

/** The conversation, following the stream while the reader is at the bottom. Projected content shows while it is empty. */
@Component({
  selector: "kl-message-list",
  imports: [KlIcon, MessageItem, MessageRow],
  host: { style: "display: contents" },
  template: `
    <div #scroller class="kl-list kl-scroll" (scroll)="pinned.set(nearBottom())">
      <div class="kl-list__inner">
        @if (!messages().length) {
          <ng-content />
        }
        @let revisionOf = revisions();
        @for (message of messages(); track message.id) {
          @if (revisionOf) {
            <kl-message-row [message]="message" [revision]="revisionOf(message.id)" [showMeta]="showMeta()" />
          } @else {
            <kl-message-item [message]="message" [showMeta]="showMeta()" />
          }
        }
        <div class="kl-sr-only" aria-live="polite">{{ running() ? i18n().t("messages.working") : "" }}</div>
      </div>
      @if (!pinned()) {
        <button type="button" class="kl-list__jump kl-btn kl-btn--sm" (click)="scrollToBottom(true)">
          <svg klIcon name="arrowDown" [size]="12" /> {{ i18n().t("messages.latest") }}
        </button>
      }
    </div>
  `,
})
export class MessageList {
  readonly messages = input.required<readonly ChatMessage[]>();
  readonly running = input(false, { transform: booleanAttribute });
  readonly showMeta = input(false, { transform: booleanAttribute });
  private readonly store = injectOptionalStoreRef();
  protected readonly i18n = injectI18n();
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>("scroller");
  protected readonly pinned = signal(true);

  constructor() {
    let firstId: string | undefined | null = null;
    let tail = "";
    afterEveryRender(() => {
      const messages = this.messages();
      // A different conversation (or the first render) starts at the bottom.
      if (messages[0]?.id !== firstId) {
        firstId = messages[0]?.id;
        tail = tailSignature(messages);
        this.scrollToBottom();
        return;
      }
      // Follow the stream while the reader is at the bottom; leave them alone once they scroll up.
      const next = tailSignature(messages);
      if (next === tail) return;
      tail = next;
      if (this.pinned()) this.scrollToBottom();
    });
  }

  /**
   * The store's message revisions when these are its own messages; reading the store also renders the list on
   * each change. Any other messages render without memoizing.
   */
  protected revisions(): ((id: string) => number) | undefined {
    const store = this.store?.();
    if (!store) return undefined;
    return this.messages() === agentState(store)().messages ? store.getMessageRevision : undefined;
  }

  protected nearBottom() {
    const el = this.scroller().nativeElement;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  protected scrollToBottom(smooth = false) {
    const el = this.scroller().nativeElement;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    this.pinned.set(true);
  }
}
