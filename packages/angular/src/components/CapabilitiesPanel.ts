import { ChangeDetectionStrategy, Component, computed, signal } from "@angular/core";
import type { McpServerInfo, ToolInfo } from "@klymbak/protocol";
import { injectAgentState, injectI18n, injectStoreRef } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";

const EMPTY_FORM = { name: "", url: "", token: "" };
const serverStatus = {
  connecting: "caps.status.connecting",
  connected: "caps.status.connected",
  error: "caps.status.error",
  disabled: "caps.status.disabled",
} as const;

type Field = keyof typeof EMPTY_FORM;

@Component({
  selector: "kl-capabilities-panel",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @if (state().config; as config) {
      @let f = form();
      <div class="kl-caps">
        <p class="kl-caps__intro">
          @for (part of intro(); track $index) {
            @switch (part.arg) {
              @case ("name") {
                <strong>{{ part.text }}</strong>
              }
              @case ("roles") {
                <span class="kl-faint">{{ part.text }}</span>
              }
              @case ("asksFirst") {
                <span class="kl-pill kl-tone-warning">{{ part.text }}</span>
              }
              @default {
                {{ part.text }}
              }
            }
          }
        </p>

        @if (config.subagents.length > 0) {
          <section class="kl-caps__section">
            <h4><svg klIcon name="agents" [size]="14" /> {{ i18n().t("caps.specialists") }}</h4>
            @for (agent of config.subagents; track agent.name) {
              <div class="kl-cap">
                <div class="kl-cap__top">
                  <span class="kl-cap__name" style="text-transform: capitalize">{{ agent.name }}</span>
                </div>
                <p class="kl-cap__desc">{{ agent.description }}</p>
                <p class="kl-cap__tools kl-faint">{{ i18n().t("caps.toolCount", { count: agent.tools.length }) }}</p>
              </div>
            }
          </section>
        }

        @if (config.skills.length > 0) {
          <section class="kl-caps__section">
            <h4><svg klIcon name="file" [size]="14" /> {{ i18n().t("caps.skills") }} <span class="kl-faint">{{ config.skills.length }}</span></h4>
            @for (skill of config.skills; track skill.name) {
              <div class="kl-cap">
                <div class="kl-cap__top">
                  <span class="kl-cap__name">{{ skill.name }}</span>
                </div>
                <p class="kl-cap__desc">{{ skill.description }}</p>
              </div>
            }
          </section>
        }

        @for (group of groups(); track group.key) {
          <section class="kl-caps__section">
            <h4><svg klIcon [name]="group.icon" [size]="14" /> {{ group.title }} <span class="kl-faint">{{ group.tools.length }}</span></h4>
            @for (tool of group.tools; track tool.name) {
              <div class="kl-cap">
                <div class="kl-cap__top">
                  <span class="kl-cap__name">{{ tool.label }}</span>
                  @if (tool.approval !== "never") {
                    <span class="kl-pill kl-tone-warning">{{ i18n().t(tool.approval === "always" ? "caps.asksFirst" : "caps.mayAsk") }}</span>
                  } @else if (tool.readOnly) {
                    <span class="kl-pill">{{ i18n().t("caps.readOnly") }}</span>
                  }
                </div>
                <p class="kl-cap__desc">{{ tool.description }}</p>
              </div>
            }
          </section>
        }

        <section class="kl-caps__section">
          <h4><svg klIcon name="plug" [size]="14" /> {{ i18n().t("caps.integrations") }}</h4>
          @for (server of config.mcpServers; track server.name) {
            <div class="kl-mcp">
              <span class="kl-mcp__dot kl-mcp__dot--{{ server.status }}" [title]="statusLabel(server)"></span>
              <div class="kl-mcp__body">
                <span class="kl-cap__name">{{ server.name }}</span>
                <span class="kl-faint">{{ server.transport }} · {{ i18n().t("caps.toolCount", { count: server.tools.length }) }} · {{ statusLabel(server) }}</span>
                @if (server.error) {
                  <span class="kl-mcp__error">{{ server.error }}</span>
                }
              </div>
              @if (server.runtime && config.features.runtimeMcp) {
                <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" (click)="store().removeMcpServer(server.name)">{{ i18n().t("caps.remove") }}</button>
              }
            </div>
          }
          @if (!config.mcpServers.length) {
            <p class="kl-faint">{{ i18n().t("caps.noServers") }}</p>
          }

          @if (config.features.runtimeMcp) {
            <form class="kl-mcp-form" (submit)="connect($event)">
              <span class="kl-mcp-form__title">{{ i18n().t("caps.connectTitle") }}</span>
              <input
                #name
                class="kl-input"
                required
                pattern="[A-Za-z0-9_-]+"
                [placeholder]="i18n().t('caps.serverNamePlaceholder')"
                [attr.aria-label]="i18n().t('caps.serverName')"
                [value]="f.name"
                (input)="set('name', name.value)"
              />
              <input
                #url
                class="kl-input"
                required
                type="url"
                placeholder="https://mcp.example.com/mcp"
                [attr.aria-label]="i18n().t('caps.serverUrl')"
                [value]="f.url"
                (input)="set('url', url.value)"
              />
              <input
                #token
                class="kl-input"
                type="password"
                [placeholder]="i18n().t('caps.tokenPlaceholder')"
                [attr.aria-label]="i18n().t('caps.token')"
                autocomplete="off"
                [value]="f.token"
                (input)="set('token', token.value)"
              />
              @if (addError()) {
                <p class="kl-mcp__error">{{ addError() }}</p>
              }
              <button type="submit" class="kl-btn kl-btn--sm" [disabled]="adding()">
                @if (adding()) {
                  <span class="kl-spinner"></span>
                }
                {{ i18n().t("caps.connect") }}
              </button>
            </form>
          }
        </section>
      </div>
    }
  `,
})
export class CapabilitiesPanel {
  protected readonly store = injectStoreRef();
  protected readonly state = injectAgentState();
  protected readonly i18n = injectI18n();
  protected readonly form = signal(EMPTY_FORM);
  protected readonly adding = signal(false);
  protected readonly addError = signal("");

  protected readonly intro = computed(() => {
    const user = this.state().config?.user;
    const i18n = this.i18n();
    return user ? i18n.parts("caps.intro", { name: user.name, roles: user.roles.join(", "), asksFirst: i18n.t("caps.asksFirst") }) : [];
  });

  protected readonly groups = computed(() => {
    const tools = this.state().config?.tools ?? [];
    const i18n = this.i18n();
    return [
      { key: "local", title: i18n.t("caps.appActions"), icon: "tool", tools: tools.filter((t) => t.source === "local") },
      ...[...new Set(tools.filter((t) => t.source === "mcp").map((t) => t.server!))].map((server) => ({
        key: `mcp:${server}`,
        title: i18n.t("caps.mcpGroup", { server }),
        icon: "plug",
        tools: tools.filter((t) => t.source === "mcp" && t.server === server),
      })),
      { key: "builtin", title: i18n.t("caps.builtin"), icon: "clock", tools: tools.filter((t) => t.source === "builtin" || t.source === "subagent") },
    ].filter((s): s is { key: string; title: string; icon: string; tools: ToolInfo[] } => s.tools.length > 0);
  });

  protected statusLabel(server: McpServerInfo) {
    return this.i18n().t(serverStatus[server.status]);
  }

  protected set(key: Field, value: string) {
    this.form.update((current) => ({ ...current, [key]: value }));
  }

  protected async connect(event: Event) {
    event.preventDefault();
    const form = this.form();
    this.addError.set("");
    this.adding.set(true);
    try {
      const headers = form.token ? { authorization: `Bearer ${form.token}` } : undefined;
      const server = await this.store().addMcpServer(form.name.trim(), form.url.trim(), headers);
      if (server.status === "error") this.addError.set(server.error ?? this.i18n().t("caps.connectFailed"));
      else this.form.set(EMPTY_FORM);
    } catch (error) {
      this.addError.set(error instanceof Error ? error.message : this.i18n().t("caps.connectFailed"));
    } finally {
      this.adding.set(false);
    }
  }
}
