import { NgComponentOutlet } from "@angular/common";
import { Component, booleanAttribute, inject, input, signal, type DoCheck } from "@angular/core";
import { humanize, type ToolPart, type ToolStatus } from "@klymbak/protocol";
import { RENDERERS, injectI18n } from "../context.ts";
import { ApprovalPrompt } from "./ApprovalPrompt.ts";
import { KlIcon } from "./KlIcon.ts";
import { SubagentTrace } from "./SubagentTrace.ts";
import { UiBlockView } from "./blocks/UiBlockView.ts";

const TONES: Record<ToolStatus, string> = {
  streaming: "neutral",
  pending: "neutral",
  awaiting_approval: "warning",
  running: "info",
  done: "success",
  error: "danger",
  denied: "danger",
  blocked: "danger",
};

const ICONS = { mcp: "plug", builtin: "clock", subagent: "agents", local: "tool" } as const;

// Default change detection: the part is updated in place as the call runs.
@Component({
  selector: "kl-tool-call-card",
  imports: [ApprovalPrompt, KlIcon, NgComponentOutlet, SubagentTrace, UiBlockView],
  host: { style: "display: contents" },
  template: `
    @let card = view();
    @let part = card.part;
    <div class="kl-tool kl-tool--{{ part.status }}" [class.kl-tool--compact]="compact()">
      <button type="button" class="kl-tool__head" [attr.aria-expanded]="open()" (click)="open.set(!open())">
        <span class="kl-tool__icon" [class.kl-tool__icon--active]="card.active">
          @if (card.active) {
            <span class="kl-spinner"></span>
          } @else {
            <svg klIcon [name]="card.icon" [size]="14" />
          }
        </span>
        <span class="kl-tool__name">{{ card.label }}</span>
        @if (part.server) {
          <span class="kl-tool__via">{{ i18n().t("tool.via", { server: part.server }) }}</span>
        }
        @if (card.argSummary && !part.subagent) {
          <span class="kl-tool__args">{{ card.argSummary }}</span>
        }
        <span class="kl-tool__meta">
          @if (card.duration) {
            <span class="kl-faint kl-num">{{ card.duration }}</span>
          }
          <span class="kl-pill kl-tone-{{ card.tone }}">{{ card.status }}</span>
          <svg klIcon class="kl-tool__chevron" [class.kl-tool__chevron--open]="open()" name="chevronDown" [size]="14" />
        </span>
      </button>

      @if (part.approval) {
        <div class="kl-tool__section"><kl-approval-prompt [approval]="part.approval" /></div>
      }

      @if (part.progress && card.active) {
        <div class="kl-tool__progress kl-faint">{{ part.progress }}</div>
      }

      @if (card.refused && part.result && !open()) {
        <div class="kl-tool__reason">{{ part.result.text }}</div>
      }

      @if (part.subagent) {
        <div class="kl-tool__section">
          <kl-subagent-trace [subagent]="part.subagent" [result]="part.result?.text" [done]="part.status === 'done'" />
        </div>
      }

      @if (card.renderer) {
        <div class="kl-tool__section"><ng-container *ngComponentOutlet="card.renderer; inputs: { part: part }" /></div>
      } @else if (card.blocks.length > 0) {
        <div class="kl-tool__blocks">
          @for (block of card.blocks; track $index) {
            <kl-ui-block-view [block]="block" />
          }
        </div>
      }

      @if (open()) {
        <div class="kl-tool__details">
          @if (card.args.length > 0) {
            <div class="kl-tool__detail">
              <span class="kl-tool__detail-label">{{ i18n().t("tool.input") }}</span>
              <dl class="kl-tool__argList">
                @for (arg of card.args; track arg.key) {
                  <dt>{{ humanize(arg.key) }}</dt>
                  <dd [class.kl-tool__argLong]="arg.long">{{ arg.value }}</dd>
                }
              </dl>
            </div>
          }
          @if (part.result?.text && !part.subagent) {
            <div class="kl-tool__detail">
              <span class="kl-tool__detail-label">{{ i18n().t(part.result?.isError ? "tool.error" : "tool.output") }}</span>
              <pre class="kl-tool__output kl-scroll">{{ part.result?.text }}</pre>
            </div>
          }
          <div class="kl-tool__detail kl-faint kl-tool__ids">
            <span class="kl-code">{{ part.name }}</span>
            @if (part.source === "mcp") {
              <span>
                @for (piece of i18n().parts("tool.mcpFrom", { server: part.server ?? "" }); track $index) {
                  @if (piece.arg === "server") {
                    <strong>{{ piece.text }}</strong>
                  } @else {
                    {{ piece.text }}
                  }
                }
              </span>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class ToolCallCard implements DoCheck {
  readonly part = input.required<ToolPart>();
  readonly compact = input(false, { transform: booleanAttribute });
  private readonly renderers = inject(RENDERERS);
  protected readonly i18n = injectI18n();
  protected readonly open = signal(false);
  protected readonly humanize = humanize;
  private failed = false;

  // A call that fails opens, so the error is in view.
  ngDoCheck() {
    const failed = this.part().status === "error" || this.part().status === "blocked";
    if (failed && !this.failed) this.open.set(true);
    this.failed = failed;
  }

  protected view() {
    const part = this.part();
    const args =
      part.args && typeof part.args === "object"
        ? Object.entries(part.args as Record<string, unknown>).map(([key, v]) => ({
            key,
            value: typeof v === "string" ? v : JSON.stringify(v, null, 2),
            long: typeof v === "string" ? v.length > 80 || v.includes("\n") : typeof v === "object",
          }))
        : [];
    const i18n = this.i18n();
    return {
      part,
      args,
      // One-line summary of the arguments for the collapsed header.
      argSummary: args
        .filter((a) => !a.long)
        .slice(0, 3)
        .map((a) => `${humanize(a.key).toLowerCase()}: ${a.value}`)
        .join(" · "),
      status: i18n.t(`tool.status.${part.status}`),
      tone: TONES[part.status],
      active: ["streaming", "pending", "running"].includes(part.status),
      refused: ["error", "denied", "blocked"].includes(part.status),
      icon: ICONS[part.source ?? "local"],
      label: part.label ?? humanize(part.name),
      duration: part.durationMs === undefined ? "" : i18n.duration(part.durationMs),
      renderer: part.result ? this.renderers().tools?.[part.name] : undefined,
      blocks: part.result?.ui ?? [],
    };
  }
}
