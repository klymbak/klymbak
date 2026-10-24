import { ChangeDetectionStrategy, Component, booleanAttribute, computed, forwardRef, input, output, signal } from "@angular/core";
import type { UiAction } from "@klymbak/protocol";
import { selectUnreadCount } from "@klymbak/client";
import { HOST_PROVIDERS, StoreHost, agentState } from "../context.ts";
import { AgentChat } from "./AgentChat.ts";
import { CapabilitiesPanel } from "./CapabilitiesPanel.ts";
import { KlIcon } from "./KlIcon.ts";
import { SchedulePanel } from "./SchedulePanel.ts";
import { SessionList } from "./SessionList.ts";
import { ToastStack } from "./ToastStack.ts";

type Tab = "chats" | "schedules" | "capabilities";

/**
 * Full screen: conversations, schedules and capabilities in a sidebar, next to the chat. Content marked `klBrand`
 * replaces the logo and app name, `klSidebarFooter` the signed-in user, and `klHeaderEnd` goes in the chat header.
 */
@Component({
  selector: "kl-agent-workspace",
  imports: [AgentChat, CapabilitiesPanel, KlIcon, SchedulePanel, SessionList, ToastStack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: StoreHost, useExisting: forwardRef(() => AgentWorkspace) }, HOST_PROVIDERS],
  host: {
    class: "kl-root kl-workspace",
    "[class.kl-workspace--drawer]": "drawer()",
    "[attr.data-kl-theme]": "theme()",
    // `title` is an input here, not a tooltip on the whole workspace.
    "[attr.title]": "null",
  },
  template: `
    @let s = state();
    <aside class="kl-workspace__sidebar" [attr.aria-label]="i18n().t('workspace.navigation')">
      <div class="kl-workspace__brand">
        <ng-content select="[klBrand]">
          <span class="kl-workspace__logo"><svg klIcon name="sparkle" [size]="16" /></span>
          <span class="kl-workspace__app">{{ title() ?? s.config?.app?.name ?? i18n().t("chat.defaultTitle") }}</span>
        </ng-content>
        <button
          type="button"
          class="kl-btn kl-btn--ghost kl-btn--icon kl-workspace__close"
          [attr.aria-label]="i18n().t('workspace.closeMenu')"
          (click)="drawer.set(false)"
        >
          <svg klIcon name="close" [size]="16" />
        </button>
      </div>
      <div class="kl-workspace__tabs" role="tablist">
        @for (item of tabs(); track item.id) {
          <button type="button" role="tab" [attr.aria-selected]="tab() === item.id" class="kl-workspace__tab" [class.active]="tab() === item.id" (click)="tab.set(item.id)">
            <svg klIcon [name]="item.icon" [size]="14" /> {{ item.label }}
            @if (item.badge) {
              <span class="kl-workspace__badge">{{ item.badge }}</span>
            }
          </button>
        }
      </div>
      <div class="kl-workspace__panel kl-scroll">
        @switch (tab()) {
          @case ("chats") {
            <kl-session-list (open)="drawer.set(false)" />
          }
          @case ("schedules") {
            <kl-schedule-panel (openSession)="showChat()" />
          }
          @default {
            <kl-capabilities-panel />
          }
        }
      </div>
      <div class="kl-workspace__footer">
        <ng-content select="[klSidebarFooter]">
          @if (s.config; as config) {
            <span class="kl-workspace__avatar">{{ config.user.name.slice(0, 1) }}</span>
            <span class="kl-workspace__user">
              <strong>{{ config.user.name }}</strong>
              <span class="kl-faint">{{ config.user.roles.join(", ") }}</span>
            </span>
          }
        </ng-content>
      </div>
    </aside>
    <div class="kl-workspace__scrim" (click)="drawer.set(false)"></div>
    <main class="kl-workspace__main">
      <kl-agent-chat [title]="title()" [description]="description()" [suggestions]="suggestions()" [showMeta]="showMeta()" (action)="action.emit($event)">
        <button
          klHeaderStart
          type="button"
          class="kl-btn kl-btn--ghost kl-btn--icon kl-workspace__menu"
          [attr.aria-label]="i18n().t('workspace.openMenu')"
          (click)="drawer.set(true)"
        >
          <svg klIcon name="menu" [size]="18" />
        </button>
        <ng-content select="[klHeaderEnd]" ngProjectAs="[klHeaderEnd]" />
      </kl-agent-chat>
    </main>
    <kl-toast-stack (openSession)="showChat()" />
  `,
})
export class AgentWorkspace extends StoreHost {
  /** The app's name in the sidebar and the chat. Defaults to the server's app.name. */
  readonly title = input<string>();
  /** Text under the title on the welcome screen. Defaults to the server's app.description. */
  readonly description = input<string>();
  readonly suggestions = input<string[]>();
  readonly theme = input<"auto" | "light" | "dark">("auto");
  /** Show model, tokens and cost under each answer. */
  readonly showMeta = input(true, { transform: booleanAttribute });
  readonly action = output<UiAction>();

  protected readonly tag = "kl-agent-workspace";
  protected readonly tab = signal<Tab>("chats");
  protected readonly drawer = signal(false);
  protected readonly state = computed(() => agentState(this.store)(), { equal: () => false });
  protected readonly tabs = computed(() => {
    const state = this.state();
    const i18n = this.i18n();
    return [
      { id: "chats" as const, label: i18n.t("workspace.chats"), icon: "chat", badge: selectUnreadCount(state) || undefined },
      ...(state.config?.features.schedules ? [{ id: "schedules" as const, label: i18n.t("workspace.schedules"), icon: "clock", badge: undefined }] : []),
      { id: "capabilities" as const, label: i18n.t("workspace.tools"), icon: "tool", badge: undefined },
    ];
  });

  protected showChat() {
    this.tab.set("chats");
    this.drawer.set(false);
  }
}
