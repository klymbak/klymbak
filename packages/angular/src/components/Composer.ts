import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, booleanAttribute, computed, input, output, signal, viewChild } from "@angular/core";
import type { Attachment } from "@klymbak/client";
import { injectI18n } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";

export interface ComposerSend {
  text: string;
  attachments: Attachment[];
}

/** The message box. Projected content goes at the start of the toolbar, such as the model picker. */
@Component({
  selector: "kl-composer",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    <form class="kl-composer" [class.kl-composer--running]="running()" (submit)="submit($event)">
      @if (attachments().length > 0) {
        <div class="kl-composer__files">
          @for (file of attachments(); track $index; let i = $index) {
            <span class="kl-composer__file">
              <img [src]="'data:' + file.mimeType + ';base64,' + file.data" [alt]="file.name" />
              <button
                type="button"
                class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
                [attr.aria-label]="i18n().t('composer.removeFile', { name: file.name })"
                (click)="remove(i)"
              >
                <svg klIcon name="close" [size]="12" />
              </button>
            </span>
          }
        </div>
      }
      <textarea
        #input
        class="kl-composer__input"
        rows="1"
        [placeholder]="running() ? i18n().t('composer.placeholderRunning') : (placeholder() ?? i18n().t('composer.placeholder'))"
        [disabled]="disabled()"
        [attr.aria-label]="i18n().t('composer.label')"
        (input)="text.set(input.value)"
        (keydown)="onKeyDown($event)"
        (paste)="onPaste($event)"
      ></textarea>
      <div class="kl-composer__bar">
        <ng-content />
        @if (acceptImages()) {
          <button
            type="button"
            class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
            [attr.aria-label]="i18n().t('composer.attachImage')"
            [title]="i18n().t('composer.attachImage')"
            (click)="fileInput.click()"
          >
            <svg klIcon name="image" [size]="15" />
          </button>
        }
        <input #fileInput type="file" accept="image/*" multiple hidden (change)="onFiles(fileInput)" />
        <span class="kl-composer__spacer"></span>
        @if (running()) {
          <button type="button" class="kl-btn kl-btn--sm" (click)="stop.emit()"><svg klIcon name="stop" [size]="12" /> {{ i18n().t("composer.stop") }}</button>
        }
        <button
          type="submit"
          class="kl-btn kl-btn--primary kl-btn--icon kl-composer__send"
          [disabled]="!canSend()"
          [attr.aria-label]="i18n().t(running() ? 'composer.sendInstruction' : 'composer.send')"
        >
          <svg klIcon name="send" [size]="16" />
        </button>
      </div>
      @if (running()) {
        <p class="kl-composer__hint">{{ i18n().t("composer.runningHint") }}</p>
      }
    </form>
  `,
})
export class Composer {
  readonly running = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly placeholder = input<string>();
  readonly acceptImages = input(false, { transform: booleanAttribute });
  readonly send = output<ComposerSend>();
  readonly stop = output<void>();

  protected readonly i18n = injectI18n();
  protected readonly text = signal("");
  protected readonly attachments = signal<Attachment[]>([]);
  protected readonly canSend = computed(() => !this.disabled() && (this.text().trim().length > 0 || this.attachments().length > 0));
  private readonly input = viewChild.required<ElementRef<HTMLTextAreaElement>>("input");
  private focusAfterSet = false;

  constructor() {
    afterRenderEffect(() => {
      const text = this.text();
      const el = this.input().nativeElement;
      // Written here rather than with [value]: typing and Enter can both happen before Angular renders, and a
      // binding that last rendered "" would skip clearing the box. This compares with what the box holds.
      if (el.value !== text) el.value = text;
      // Grow with the text, up to a limit. A hidden box (a closed widget) measures 0: leave it at its natural height.
      el.style.height = "auto";
      if (el.scrollHeight) el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
      if (this.focusAfterSet) {
        this.focusAfterSet = false;
        el.focus();
      }
    });
  }

  focus() {
    this.input().nativeElement.focus();
  }

  /** Replaces the draft and focuses the box. */
  setText(value: string) {
    this.focusAfterSet = true;
    this.text.set(value);
  }

  protected submit(event?: Event) {
    event?.preventDefault();
    if (!this.canSend()) return;
    this.send.emit({ text: this.text(), attachments: this.attachments() });
    this.text.set("");
    this.attachments.set([]);
  }

  protected onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    }
  }

  protected remove(index: number) {
    this.attachments.update((current) => current.filter((_, j) => j !== index));
  }

  protected onFiles(input: HTMLInputElement) {
    void this.addFiles(input.files ?? []);
    input.value = "";
  }

  protected onPaste(event: ClipboardEvent) {
    if (!this.acceptImages()) return;
    const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      event.preventDefault();
      void this.addFiles(files);
    }
  }

  private async addFiles(files: FileList | File[]) {
    const added: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) continue;
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      added.push({ name: file.name, mimeType: file.type, data });
    }
    if (added.length) this.attachments.update((current) => [...current, ...added]);
  }
}
