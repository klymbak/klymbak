import { ChangeDetectionStrategy, Component, afterNextRender, computed, forwardRef, inject, input, output } from "@angular/core";
import { HOST_PROVIDERS, INSIDE_ROOT, StoreHost, agentState } from "../context.ts";
import { ApprovalPrompt } from "./ApprovalPrompt.ts";
import { KlIcon } from "./KlIcon.ts";
import { ToastStack } from "./ToastStack.ts";

const sourceIcons = { schedule: "clock", api: "sparkle", chat: "chat" } as const;
const sourceLabels = { schedule: "inbox.source.schedule", api: "inbox.source.api", chat: "inbox.source.chat" } as const;

/**
 * The approval inbox: what unattended runs left waiting, across conversations, for the signed-in person to approve,
 * deny with a reason, or edit first. The server lists only what their roles let them decide, oldest first. Content
 * marked `klHeaderStart` or `klHeaderEnd` goes in the header.
 */
@Component({
  selector: "kl-approval-inbox",
  imports: [ApprovalPrompt, KlIcon, ToastStack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: StoreHost, useExisting: forwardRef(() => ApprovalInbox) }, HOST_PROVIDERS],
  host: {
    class: "kl-inbox",
    "[class.kl-root]": "!insideRoot",
    "[attr.data-kl-theme]": "insideRoot ? null : theme()",
    role: "region",
    "[attr.aria-label]": "i18n().t('inbox.title')",
  },
  template: `
    @let items = state().inbox;
    <header class="kl-inbox__header">
      <ng-content select="[klHeaderStart]" />
      <h2 class="kl-inbox__title">{{ i18n().t("inbox.title") }}</h2>
      @if (items.length) {
        <span class="kl-pill kl-tone-warning">{{ i18n().number(items.length) }}</span>
      }
      <ng-content select="[klHeaderEnd]" />
    </header>
    <div class="kl-inbox__body kl-scroll">
      <div class="kl-inbox__list">
        @if (items.length) {
          <p class="kl-inbox__intro">{{ i18n().t("inbox.intro") }}</p>
        } @else {
          <p class="kl-inbox__empty"><svg klIcon name="shield" [size]="22" />{{ i18n().t("inbox.empty") }}</p>
        }
        @for (item of items; track item.approval.id) {
          <article class="kl-inbox__item">
            <div class="kl-inbox__meta">
              <button type="button" class="kl-inbox__session" [title]="i18n().t('inbox.open')" (click)="open(item.sessionId)">
                <svg klIcon [name]="sourceIcons[item.source]" [size]="13" />
                <span>{{ item.sessionTitle }}</span>
              </button>
              <span>{{ i18n().t(sourceLabels[item.source]) }} · {{ i18n().timeAgo(item.createdAt) }}</span>
            </div>
            <kl-approval-prompt [approval]="item.approval" [sessionId]="item.sessionId" />
          </article>
        }
      </div>
    </div>
    <!-- On its own, it shows why a decision didn't go through; inside the workspace, the workspace does. -->
    @if (!insideRoot) {
      <kl-toast-stack (openSession)="openSession.emit($event)" />
    }
  `,
})
export class ApprovalInbox extends StoreHost {
  readonly theme = input<"auto" | "light" | "dark">("auto");
  /** An item's conversation was opened in the store, for the host to show it. */
  readonly openSession = output<string>();

  protected readonly tag = "kl-approval-inbox";
  protected readonly insideRoot = inject(INSIDE_ROOT, { skipSelf: true });
  protected readonly state = computed(() => agentState(this.store)(), { equal: () => false });
  protected readonly sourceIcons = sourceIcons;
  protected readonly sourceLabels = sourceLabels;

  constructor() {
    super();
    // The store keeps it current; catch up in case this shows long after the store loaded.
    afterNextRender(() => {
      if (this.store.state.ready) void this.store.refreshInbox();
    });
  }

  protected open(sessionId: string) {
    void this.store.openSession(sessionId);
    this.openSession.emit(sessionId);
  }
}
