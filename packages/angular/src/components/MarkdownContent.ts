import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input } from "@angular/core";
import { DomSanitizer } from "@angular/platform-browser";
import { renderMarkdown } from "@klymbak/client";

@Component({
  selector: "kl-markdown-content",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `<div class="kl-md" [class.kl-md--streaming]="streaming()" [innerHTML]="html()"></div>`,
})
export class MarkdownContent {
  readonly source = input.required<string>();
  readonly streaming = input(false, { transform: booleanAttribute });
  private readonly sanitizer = inject(DomSanitizer);
  // markdown-it runs with html disabled, so model output cannot inject markup. Its HTML goes in as the other
  // bindings render it; Angular's sanitizer would strip attributes it sets on purpose.
  protected readonly html = computed(() => this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(this.source())));
}
