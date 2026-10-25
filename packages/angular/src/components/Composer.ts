import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import type { McpCompleteRequest, McpPromptInfo, McpResourceInfo, McpResourceTemplateInfo } from "@klymbak/protocol";
import {
  createSuggester,
  findMention,
  insertMention,
  mentionKey,
  mentionOptions,
  promptFields,
  promptLabel,
  promptReady,
  removeMention,
  templateFields,
  templateReady,
  type Attachment,
  type McpReferences,
  type MentionOption,
  type ReferenceFields,
} from "@klymbak/client";
import { injectI18n } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";

export interface ComposerSend {
  text: string;
  attachments: Attachment[];
  /** MCP resources mentioned with @ and a prompt chosen with /. */
  references: McpReferences;
}

interface Templated {
  id: number;
  template: McpResourceTemplateInfo;
  values: Record<string, string>;
}

/** The values a chosen prompt or a templated resource asks for. */
interface FieldGroup {
  key: string;
  fields: ReferenceFields;
  values: Record<string, string>;
}

let nextMenuId = 0;

/** The message box. Projected content goes at the start of the toolbar, such as the model picker. */
@Component({
  selector: "kl-composer",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    <form class="kl-composer" [class.kl-composer--running]="running()" (submit)="submit($event)">
      @if (options().length > 0) {
        <div [id]="menuId" class="kl-mention-menu kl-scroll" role="listbox" [attr.aria-label]="menuLabel()">
          <span class="kl-mention-menu__title" aria-hidden="true">{{ menuLabel() }}</span>
          @for (option of options(); track option.key; let i = $index) {
            <div
              [id]="menuId + '-' + i"
              role="option"
              class="kl-mention-menu__option"
              [class.kl-mention-menu__option--active]="i === active()"
              [attr.aria-selected]="i === active()"
              (mousedown)="$event.preventDefault()"
              (mousemove)="highlight.set({ key: menuKey(), index: i })"
              (click)="choose(option)"
            >
              <svg klIcon [name]="option.prompt ? 'chat' : option.template ? 'database' : 'file'" [size]="14" />
              <span class="kl-mention-menu__text">
                <span class="kl-mention-menu__name">{{ option.name }}</span>
                @if (option.detail) {
                  <span class="kl-mention-menu__detail">{{ option.detail }}</span>
                }
              </span>
              <span class="kl-mention-menu__server">{{ option.server }}</span>
            </div>
          }
        </div>
      }
      @if (prompt() || mentioned().length > 0 || templated().length > 0) {
        <div class="kl-composer__refs">
          @if (prompt(); as chosen) {
            <span class="kl-ref kl-ref--prompt" [title]="chosen.description ?? ''">
              <svg klIcon name="chat" [size]="12" />
              <span class="kl-ref__name">/{{ label(chosen) }}</span>
              <button
                type="button"
                class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
                [attr.aria-label]="i18n().t('composer.removeFile', { name: label(chosen) })"
                (click)="removePrompt()"
              >
                <svg klIcon name="close" [size]="10" />
              </button>
            </span>
          }
          @for (resource of mentioned(); track resource.server + resource.uri; let i = $index) {
            <span class="kl-ref" [title]="resource.uri">
              <svg klIcon name="file" [size]="12" />
              <span class="kl-ref__name">{{ resource.name }}</span>
              <button
                type="button"
                class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
                [attr.aria-label]="i18n().t('composer.removeFile', { name: resource.name })"
                (click)="removeResource(i)"
              >
                <svg klIcon name="close" [size]="10" />
              </button>
            </span>
          }
          @for (entry of templated(); track entry.id) {
            <span class="kl-ref" [title]="entry.template.uriTemplate">
              <svg klIcon name="database" [size]="12" />
              <span class="kl-ref__name">{{ entry.template.name }}</span>
              <button
                type="button"
                class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm"
                [attr.aria-label]="i18n().t('composer.removeFile', { name: entry.template.name })"
                (click)="removeTemplated(entry.id)"
              >
                <svg klIcon name="close" [size]="10" />
              </button>
            </span>
          }
        </div>
      }
      @for (group of groups(); track group.key) {
        <div class="kl-composer__args" role="group" [attr.data-fields]="group.key" [attr.aria-label]="i18n().t('composer.promptValues', { name: group.fields.label })">
          @if (groups().length > 1) {
            <span class="kl-composer__args-label" aria-hidden="true">{{ group.fields.label }}</span>
          }
          @for (field of group.fields.fields; track field.name; let i = $index) {
            <input
              class="kl-input kl-composer__arg"
              [value]="valueOf(group, field.name)"
              [placeholder]="fieldLabel(field)"
              [attr.aria-label]="fieldLabel(field)"
              [title]="field.description ?? ''"
              [required]="field.required"
              [attr.list]="listId(group, i)"
              autocomplete="off"
              (input)="setValue(group, field.name, $any($event.target).value)"
              (focus)="suggest(group, field.name)"
            />
            @if (listId(group, i); as list) {
              <datalist [id]="list">
                @for (value of suggestionsFor(group, field.name); track value) {
                  <option [value]="value"></option>
                }
              </datalist>
            }
          }
        </div>
      }
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
        [attr.aria-autocomplete]="resources()?.length || resourceTemplates()?.length || prompts()?.length ? 'list' : null"
        [attr.aria-controls]="options().length ? menuId : null"
        [attr.aria-activedescendant]="options().length ? menuId + '-' + active() : null"
        (input)="track(input.value, input.selectionStart)"
        (keydown)="onKeyDown($event)"
        (keyup)="caret.set(input.selectionStart)"
        (click)="caret.set(input.selectionStart)"
        (focus)="focused.set(true)"
        (blur)="focused.set(false)"
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
  /** MCP resources to offer after @. */
  readonly resources = input<McpResourceInfo[]>();
  /** MCP resource templates to offer after @, each asking for its variables. */
  readonly resourceTemplates = input<McpResourceTemplateInfo[]>();
  /** MCP prompts to offer after / at the start of the message. */
  readonly prompts = input<McpPromptInfo[]>();
  /** Where suggestions for a prompt's arguments and a template's variables come from. */
  readonly complete = input<(request: McpCompleteRequest) => Promise<string[]>>();
  readonly send = output<ComposerSend>();
  readonly stop = output<void>();

  protected readonly i18n = injectI18n();
  protected readonly text = signal("");
  protected readonly attachments = signal<Attachment[]>([]);
  protected readonly mentioned = signal<McpResourceInfo[]>([]);
  /** Resources from templates, each waiting for its values. */
  protected readonly templated = signal<Templated[]>([]);
  protected readonly prompt = signal<McpPromptInfo | undefined>(undefined);
  protected readonly values = signal<Record<string, string>>({});
  protected readonly groups = computed<FieldGroup[]>(() => {
    const prompt = this.prompt();
    return [
      ...(prompt?.arguments.length ? [{ key: "prompt", fields: promptFields(prompt), values: this.values() }] : []),
      ...this.templated().map((entry) => ({ key: `t${entry.id}`, fields: templateFields(entry.template), values: entry.values })),
    ];
  });
  protected readonly canSend = computed(() => {
    const prompt = this.prompt();
    return (
      !this.disabled() &&
      (!prompt || promptReady(prompt, this.values())) &&
      this.templated().every((entry) => templateReady(entry.template, entry.values)) &&
      Boolean(this.text().trim() || this.attachments().length || this.mentioned().length || this.templated().length || prompt)
    );
  });

  // The @ and / menu follows the caret while the box has focus.
  protected readonly caret = signal(0);
  protected readonly focused = signal(false);
  /** Where a mention closed with Escape starts: its menu stays closed until another one begins. */
  private readonly dismissed = signal<number | undefined>(undefined);
  protected readonly highlight = signal({ key: "", index: 0 });
  protected readonly menuId = `kl-mentions-${++nextMenuId}`;
  private readonly mention = computed(() =>
    this.focused() && !this.running() && !this.disabled() ? findMention(this.text(), this.caret()) : undefined,
  );
  protected readonly menuKey = computed(() => {
    const mention = this.mention();
    return mention ? `${mention.start}:${mention.query}` : "";
  });
  protected readonly options = computed(() => {
    const mention = this.mention();
    if (!mention || mention.start === this.dismissed()) return [];
    return mentionOptions(
      mention,
      { resources: this.resources(), resourceTemplates: this.resourceTemplates(), prompts: this.prompts() },
      { resources: this.mentioned(), prompt: this.prompt() },
    );
  });
  protected readonly active = computed(() => {
    const highlight = this.highlight();
    return highlight.key === this.menuKey() ? Math.min(highlight.index, this.options().length - 1) : 0;
  });
  protected readonly menuLabel = computed(() => this.i18n().t(this.mention()?.kind === "prompt" ? "composer.prompts" : "composer.resources"));

  // Suggestions for the field being typed into, from the server, as a datalist.
  private readonly suggestions = signal<Record<string, string[]>>({});
  private readonly suggester = createSuggester(
    (request) => this.complete()?.(request) ?? Promise.resolve([]),
    (key, found) => this.suggestions.update((current) => ({ ...current, [key]: found })),
  );

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly input = viewChild.required<ElementRef<HTMLTextAreaElement>>("input");
  private focusAfterSet = false;
  /** Where the caret goes once text changed by choosing from the menu has rendered. */
  private caretAfterSet?: number;
  /** The group of fields whose first one takes the focus once it has rendered. */
  private focusFields?: string;
  private nextTemplateId = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.suggester.dispose());
    afterRenderEffect(() => {
      const text = this.text();
      const el = this.input().nativeElement;
      // Written here rather than with [value]: typing and Enter can both happen before Angular renders, and a
      // binding that last rendered "" would skip clearing the box. This compares with what the box holds.
      if (el.value !== text) el.value = text;
      // Grow with the text, up to a limit. A hidden box (a closed widget) measures 0: leave it at its natural height.
      el.style.height = "auto";
      if (el.scrollHeight) el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
      if (this.caretAfterSet !== undefined) {
        el.setSelectionRange(this.caretAfterSet, this.caretAfterSet);
        this.caretAfterSet = undefined;
      }
      if (this.focusAfterSet) {
        this.focusAfterSet = false;
        el.focus();
      }
    });
    // The values of a prompt or template come first once it's chosen.
    afterRenderEffect(() => {
      this.groups();
      if (!this.focusFields) return;
      this.host.nativeElement.querySelector<HTMLInputElement>(`[data-fields="${this.focusFields}"] input`)?.focus();
      this.focusFields = undefined;
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

  protected label(prompt: McpPromptInfo) {
    return promptLabel(prompt);
  }

  protected fieldLabel(field: ReferenceFields["fields"][number]) {
    return field.required ? field.label : this.i18n().t("composer.optional", { name: field.label });
  }

  protected valueOf(group: FieldGroup, name: string): string {
    return group.values[name] ?? "";
  }

  protected listId(group: FieldGroup, index: number): string | null {
    return group.fields.completes && this.complete() ? `${this.menuId}-${group.key}-${index}` : null;
  }

  protected suggestionsFor(group: FieldGroup, name: string): string[] {
    return this.suggestions()[`${group.key}:${name}`] ?? [];
  }

  protected setValue(group: FieldGroup, name: string, value: string) {
    const next = { ...group.values, [name]: value };
    if (group.key === "prompt") this.values.set(next);
    else this.templated.update((current) => current.map((entry) => (`t${entry.id}` === group.key ? { ...entry, values: next } : entry)));
    this.suggest({ ...group, values: next }, name);
  }

  protected suggest(group: FieldGroup, name: string) {
    if (group.fields.completes && this.complete()) this.suggester.ask(`${group.key}:${name}`, group.fields.request(name, group.values));
  }

  /** Follows the text and caret; a mention that's gone takes its dismissal with it. */
  protected track(value: string, caret: number) {
    this.text.set(value);
    this.caret.set(caret);
    if (findMention(value, caret)?.start !== this.dismissed()) this.dismissed.set(undefined);
  }

  protected submit(event?: Event) {
    event?.preventDefault();
    if (!this.canSend()) return;
    this.send.emit({
      text: this.text(),
      attachments: this.attachments(),
      references: {
        resources: this.mentioned(),
        templates: this.templated().map(({ template, values }) => ({ template, values })),
        prompt: this.prompt(),
        arguments: this.values(),
      },
    });
    this.text.set("");
    this.attachments.set([]);
    this.mentioned.set([]);
    this.templated.set([]);
    this.prompt.set(undefined);
    this.values.set({});
  }

  protected choose(option: MentionOption) {
    const mention = this.mention();
    if (!mention) return;
    let edit: { text: string; caret: number };
    if (option.resource) {
      const resource = option.resource;
      this.mentioned.update((current) => [...current, resource]);
      edit = insertMention(this.text(), mention, resource.name);
    } else if (option.template) {
      const entry = { id: this.nextTemplateId++, template: option.template, values: {} };
      this.templated.update((current) => [...current, entry]);
      this.focusFields = `t${entry.id}`;
      edit = insertMention(this.text(), mention, option.template.name);
    } else {
      this.prompt.set(option.prompt);
      this.values.set({});
      if (option.prompt?.arguments.length) this.focusFields = "prompt";
      edit = removeMention(this.text(), mention);
    }
    this.caretAfterSet = edit.caret;
    this.track(edit.text, edit.caret);
  }

  protected onKeyDown(event: KeyboardEvent) {
    const options = this.options();
    if (options.length && !event.shiftKey && !event.isComposing) {
      const action = mentionKey(event.key, this.active(), options.length);
      if (action !== undefined) {
        event.preventDefault();
        if (action === "choose") this.choose(options[this.active()]!);
        else if (action === "close") this.dismissed.set(this.mention()!.start);
        else this.highlight.set({ key: this.menuKey(), index: action });
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.submit();
    }
  }

  protected removePrompt() {
    this.prompt.set(undefined);
    this.values.set({});
    this.focus();
  }

  protected removeResource(index: number) {
    this.mentioned.update((current) => current.filter((_, j) => j !== index));
  }

  protected removeTemplated(id: number) {
    this.templated.update((current) => current.filter((entry) => entry.id !== id));
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
