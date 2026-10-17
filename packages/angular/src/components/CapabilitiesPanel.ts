import { ChangeDetectionStrategy, Component, computed, signal } from "@angular/core";
import type { ToolInfo } from "@klymbak/protocol";
import { injectAgentState, injectStoreRef } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";

const EMPTY_FORM = { name: "", url: "", token: "" };

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
          What the agent can do for <strong>{{ config.user.name }}</strong> <span class="kl-faint">({{ config.user.roles.join(", ") }})</span>. Actions marked
          <span class="kl-pill kl-tone-warning">asks first</span> wait for your approval.
        </p>

        @if (config.subagents.length > 0) {
          <section class="kl-caps__section">
            <h4><svg klIcon name="agents" [size]="14" /> Specialists</h4>
            @for (agent of config.subagents; track agent.name) {
              <div class="kl-cap">
                <div class="kl-cap__top">
                  <span class="kl-cap__name" style="text-transform: capitalize">{{ agent.name }}</span>
                </div>
                <p class="kl-cap__desc">{{ agent.description }}</p>
                <p class="kl-cap__tools kl-faint">{{ agent.tools.length }} tools</p>
              </div>
            }
          </section>
        }

        @if (config.skills.length > 0) {
          <section class="kl-caps__section">
            <h4><svg klIcon name="file" [size]="14" /> Skills <span class="kl-faint">{{ config.skills.length }}</span></h4>
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
                    <span class="kl-pill kl-tone-warning">{{ tool.approval === "always" ? "asks first" : "may ask" }}</span>
                  } @else if (tool.readOnly) {
                    <span class="kl-pill">read-only</span>
                  }
                </div>
                <p class="kl-cap__desc">{{ tool.description }}</p>
              </div>
            }
          </section>
        }

        <section class="kl-caps__section">
          <h4><svg klIcon name="plug" [size]="14" /> Integrations</h4>
          @for (server of config.mcpServers; track server.name) {
            <div class="kl-mcp">
              <span class="kl-mcp__dot kl-mcp__dot--{{ server.status }}" [title]="server.status"></span>
              <div class="kl-mcp__body">
                <span class="kl-cap__name">{{ server.name }}</span>
                <span class="kl-faint">{{ server.transport }} · {{ server.tools.length }} tools · {{ server.status }}</span>
                @if (server.error) {
                  <span class="kl-mcp__error">{{ server.error }}</span>
                }
              </div>
              @if (server.runtime && config.features.runtimeMcp) {
                <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" (click)="store().removeMcpServer(server.name)">Remove</button>
              }
            </div>
          }
          @if (!config.mcpServers.length) {
            <p class="kl-faint">No MCP servers connected.</p>
          }

          @if (config.features.runtimeMcp) {
            <form class="kl-mcp-form" (submit)="connect($event)">
              <span class="kl-mcp-form__title">Connect an MCP server</span>
              <input
                #name
                class="kl-input"
                required
                pattern="[A-Za-z0-9_-]+"
                placeholder="Name, e.g. stripe"
                aria-label="Server name"
                [value]="f.name"
                (input)="set('name', name.value)"
              />
              <input #url class="kl-input" required type="url" placeholder="https://mcp.example.com/mcp" aria-label="Server URL" [value]="f.url" (input)="set('url', url.value)" />
              <input
                #token
                class="kl-input"
                type="password"
                placeholder="Bearer token (optional)"
                aria-label="Bearer token"
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
                Connect
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
  protected readonly form = signal(EMPTY_FORM);
  protected readonly adding = signal(false);
  protected readonly addError = signal("");

  protected readonly groups = computed(() => {
    const tools = this.state().config?.tools ?? [];
    return [
      { key: "local", title: "App actions", icon: "tool", tools: tools.filter((t) => t.source === "local") },
      ...[...new Set(tools.filter((t) => t.source === "mcp").map((t) => t.server!))].map((server) => ({
        key: `mcp:${server}`,
        title: `${server} (MCP)`,
        icon: "plug",
        tools: tools.filter((t) => t.source === "mcp" && t.server === server),
      })),
      { key: "builtin", title: "Built-in", icon: "clock", tools: tools.filter((t) => t.source === "builtin" || t.source === "subagent") },
    ].filter((s): s is { key: string; title: string; icon: string; tools: ToolInfo[] } => s.tools.length > 0);
  });

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
      if (server.status === "error") this.addError.set(server.error ?? "Couldn't connect.");
      else this.form.set(EMPTY_FORM);
    } catch (error) {
      this.addError.set(error instanceof Error ? error.message : "Couldn't connect.");
    } finally {
      this.adding.set(false);
    }
  }
}
