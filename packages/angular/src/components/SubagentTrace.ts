import { Component, booleanAttribute, forwardRef, input, signal, type DoCheck } from "@angular/core";
import type { SubagentView } from "@klymbak/protocol";
import { KlIcon } from "./KlIcon.ts";
import { MarkdownContent } from "./MarkdownContent.ts";
import { MessageItem } from "./MessageItem.ts";

// Default change detection: the subagent's messages grow in place while it works.
@Component({
  selector: "kl-subagent-trace",
  imports: [KlIcon, MarkdownContent, forwardRef(() => MessageItem)],
  host: { style: "display: contents" },
  template: `
    @let sub = subagent();
    @let steps = stepCount();
    <div class="kl-sub">
      <div class="kl-sub__head">
        <span class="kl-sub__agent"><svg klIcon name="agents" [size]="14" /> {{ sub.agent }}</span>
        @if (sub.status === "running") {
          <span class="kl-sub__status kl-faint"><span class="kl-spinner"></span> working</span>
        }
        @if (sub.messages.length > 0) {
          <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" (click)="showSteps.set(!showSteps())">
            {{ showSteps() ? "Hide" : "Show" }} {{ steps }} {{ steps === 1 ? "step" : "steps" }}
            <svg klIcon [name]="showSteps() ? 'chevronDown' : 'chevron'" [size]="12" />
          </button>
        }
      </div>
      <p class="kl-sub__task">{{ sub.task }}</p>
      @if (showSteps()) {
        <div class="kl-sub__steps">
          @for (message of sub.messages; track message.id) {
            <kl-message-item [message]="message" compact />
          }
        </div>
      }
      @if (done() && result()) {
        <div class="kl-sub__result">
          <span class="kl-sub__result-label">Answer</span>
          <kl-markdown-content [source]="result()!" />
        </div>
      }
    </div>
  `,
})
export class SubagentTrace implements DoCheck {
  readonly subagent = input.required<SubagentView>();
  readonly result = input<string>();
  readonly done = input(false, { transform: booleanAttribute });
  protected readonly showSteps = signal(false);
  private status?: SubagentView["status"];

  // Steps show while the subagent works and fold away when it finishes.
  ngDoCheck() {
    const status = this.subagent().status;
    if (status === this.status) return;
    if (this.status === undefined) this.showSteps.set(status === "running");
    else if (status !== "running") this.showSteps.set(false);
    this.status = status;
  }

  protected stepCount() {
    return this.subagent().messages.reduce((count, m) => count + m.parts.filter((p) => p.type === "tool").length, 0);
  }
}
