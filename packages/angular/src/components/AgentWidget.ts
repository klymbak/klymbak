import { ChangeDetectionStrategy, Component, booleanAttribute, computed, forwardRef, input, output, signal, type OnInit } from "@angular/core";
import type { UiAction } from "@klymbak/protocol";
import { selectApprovals } from "@klymbak/client";
import { HOST_PROVIDERS, StoreHost, agentState } from "../context.ts";
import { KlTransition } from "../transition.ts";
import { AgentChat } from "./AgentChat.ts";
import { KlIcon } from "./KlIcon.ts";
import { ToastStack } from "./ToastStack.ts";

/**
 * A floating launcher + chat panel that drops into any existing page,
 * so teams can add the agent next to their current admin panel first.
 */
@Component({
  selector: "kl-agent-widget",
  imports: [AgentChat, KlIcon, KlTransition, ToastStack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: StoreHost, useExisting: forwardRef(() => AgentWidget) }, HOST_PROVIDERS],
  host: {
    class: "kl-root kl-widget",
    "[class.kl-widget--right]": "position() === 'right'",
    "[class.kl-widget--left]": "position() === 'left'",
    "[attr.data-kl-theme]": "theme()",
    // `title` is an input here, not a tooltip on the whole widget.
    "[attr.title]": "null",
  },
  template: `
    <div class="kl-widget__panel" role="dialog" [attr.aria-label]="title() ?? i18n().t('widget.label')" [klTransition]="open()" klTransitionName="kl-widget">
      <kl-agent-chat [title]="title()" [description]="description()" [suggestions]="suggestions()" (action)="action.emit($event)">
        <button klHeaderEnd type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" [attr.aria-label]="i18n().t('common.close')" (click)="open.set(false)">
          <svg klIcon name="close" [size]="14" />
        </button>
      </kl-agent-chat>
    </div>
    @if (!open()) {
      <button type="button" class="kl-widget__launcher" (click)="open.set(true)">
        <svg klIcon name="sparkle" [size]="18" />
        <span>{{ label() ?? i18n().t("widget.launcher") }}</span>
        @if (waiting()) {
          <span class="kl-widget__dot" [attr.aria-label]="i18n().t('widget.approvalWaiting')"></span>
        }
      </button>
    }
    <kl-toast-stack (openSession)="open.set(true)" />
  `,
})
export class AgentWidget extends StoreHost implements OnInit {
  readonly title = input<string>();
  /** Text under the title on the welcome screen. Defaults to the server's app.description. */
  readonly description = input<string>();
  readonly label = input<string>();
  readonly suggestions = input<string[]>();
  readonly theme = input<"auto" | "light" | "dark">("auto");
  readonly position = input<"right" | "left">("right");
  readonly defaultOpen = input(false, { transform: booleanAttribute });
  readonly action = output<UiAction>();

  protected readonly tag = "kl-agent-widget";
  protected readonly open = signal(false);
  protected readonly waiting = computed(() => selectApprovals(agentState(this.store)()).length > 0);

  ngOnInit() {
    this.open.set(this.defaultOpen());
  }
}
