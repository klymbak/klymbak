import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { AgentChat, AgentWidget, AgentWorkspace, injectAgentState, injectAgentStore, type UiAction } from "@klymbak/angular";

type Mode = "workspace" | "chat" | "widget";
type Theme = "auto" | "light" | "dark";

@Component({
  selector: "app-session-picker",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <select #picker aria-label="Conversation" (change)="pick(picker.value)">
      <option value="" [selected]="!state().sessionId">New conversation</option>
      @for (session of state().sessions; track session.id) {
        <option [value]="session.id" [selected]="session.id === state().sessionId">{{ session.title }}</option>
      }
    </select>
  `,
})
class SessionPicker {
  private readonly store = injectAgentStore();
  protected readonly state = injectAgentState();

  protected pick(id: string) {
    if (id) void this.store.openSession(id);
    else this.store.newSession();
  }
}

@Component({
  selector: "app-playground",
  imports: [AgentChat, AgentWidget, AgentWorkspace, SessionPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="playground" [attr.data-theme]="theme()">
      <header class="playground__bar">
        <strong>&#64;klymbak/angular</strong>
        <select #layout aria-label="Layout" (change)="mode.set($any(layout.value))">
          <option value="workspace">Workspace</option>
          <option value="chat">Chat</option>
          <option value="widget">Widget</option>
        </select>
        @if (mode() !== "workspace") {
          <app-session-picker />
        }
        <select #themes aria-label="Theme" (change)="theme.set($any(themes.value))">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="auto">Auto</option>
        </select>
      </header>
      <main class="playground__main">
        @switch (mode()) {
          @case ("workspace") {
            <kl-agent-workspace [theme]="theme()" (action)="onAction($event)" />
          }
          @case ("chat") {
            <kl-agent-chat [theme]="theme()" showMeta (action)="onAction($event)" />
          }
          @case ("widget") {
            <p class="playground__page">An existing admin page. The agent sits in the corner.</p>
            <kl-agent-widget [theme]="theme()" label="Ask the agent" />
          }
        }
      </main>
    </div>
  `,
})
export class Playground {
  protected readonly mode = signal<Mode>("workspace");
  protected readonly theme = signal<Theme>("light");

  protected onAction(action: UiAction) {
    console.info("[playground] action", action);
  }
}
