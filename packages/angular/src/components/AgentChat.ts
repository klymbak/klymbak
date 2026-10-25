import { ChangeDetectionStrategy, Component, booleanAttribute, computed, effect, forwardRef, inject, input, output, viewChild } from "@angular/core";
import type { UiAction } from "@klymbak/protocol";
import { selectCurrentModel, selectCurrentSession } from "@klymbak/client";
import { CHAT_ACTIONS, HOST_PROVIDERS, INSIDE_ROOT, StoreHost, agentState, type ChatActions } from "../context.ts";
import { Composer, type ComposerSend } from "./Composer.ts";
import { KlIcon } from "./KlIcon.ts";
import { MessageList } from "./MessageList.ts";
import { ModelPicker } from "./ModelPicker.ts";

/**
 * A single conversation, for a page or a panel. Content marked `klHeaderStart` or `klHeaderEnd` goes in the
 * header; content marked `klEmpty` replaces the welcome screen of an empty conversation.
 */
@Component({
  selector: "kl-agent-chat",
  imports: [Composer, KlIcon, MessageList, ModelPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: StoreHost, useExisting: forwardRef(() => AgentChat) },
    HOST_PROVIDERS,
    { provide: CHAT_ACTIONS, useFactory: () => inject(AgentChat).actions },
  ],
  host: {
    class: "kl-chat",
    "[class.kl-root]": "!insideRoot",
    "[attr.data-kl-theme]": "insideRoot ? null : theme()",
    role: "region",
    "[attr.aria-label]": "i18n().t('chat.label')",
    // `title` is an input here, not a tooltip on the whole chat.
    "[attr.title]": "null",
  },
  template: `
    @let s = state();
    @if (showHeader()) {
      <header class="kl-chat__header">
        <ng-content select="[klHeaderStart]" />
        <div class="kl-chat__titles">
          <span class="kl-chat__title">{{ sessionTitle() ?? heading() }}</span>
          @if (sessionTitle()) {
            <span class="kl-chat__subtitle">{{ heading() }}</span>
          }
        </div>
        @if (s.running) {
          <span class="kl-chat__status"><span class="kl-spinner"></span> {{ i18n().t("chat.working") }}</span>
        }
        <ng-content select="[klHeaderEnd]" />
        <button type="button" class="kl-btn kl-btn--sm" [disabled]="!s.sessionId" (click)="store.newSession()">
          <svg klIcon name="plus" [size]="14" /> {{ i18n().t("chat.newChat") }}
        </button>
      </header>
    }

    @if (s.error) {
      <div class="kl-chat__fatal">
        <svg klIcon name="alert" [size]="18" />
        <div>
          <strong>{{ i18n().t("chat.unreachable") }}</strong>
          <p>{{ i18n().text(s.error) }}</p>
          <button type="button" class="kl-btn kl-btn--sm" (click)="store.init()">{{ i18n().t("chat.retry") }}</button>
        </div>
      </div>
    } @else {
      <kl-message-list [messages]="s.messages" [running]="s.running" [showMeta]="showMeta()">
        <ng-content select="[klEmpty]">
          @if (!s.loadingSession) {
            <div class="kl-welcome">
              <span class="kl-welcome__mark"><svg klIcon name="sparkle" [size]="20" /></span>
              <h2 class="kl-welcome__title">{{ heading() }}</h2>
              @if (welcomeText()) {
                <p class="kl-welcome__text">{{ welcomeText() }}</p>
              }
              @if (suggestionList().length > 0) {
                <div class="kl-welcome__suggestions">
                  @for (suggestion of suggestionList(); track suggestion) {
                    <button type="button" class="kl-welcome__suggestion" (click)="store.send(suggestion)">{{ suggestion }}</button>
                  }
                </div>
              }
            </div>
          }
        </ng-content>
      </kl-message-list>
    }

    <div class="kl-chat__footer">
      @if (s.runError) {
        <div class="kl-chat__error" role="alert"><svg klIcon name="alert" [size]="14" /> {{ i18n().text(s.runError) }}</div>
      }
      <kl-composer
        [running]="s.running"
        [disabled]="!s.ready"
        [placeholder]="placeholder()"
        [acceptImages]="acceptImages()"
        [resources]="s.config?.resources"
        [resourceTemplates]="s.config?.resourceTemplates"
        [prompts]="s.config?.prompts"
        [complete]="store.completeMcp"
        (send)="send($event)"
        (stop)="store.abort()"
      >
        <kl-model-picker />
      </kl-composer>
    </div>
  `,
})
export class AgentChat extends StoreHost {
  readonly title = input<string>();
  /** Text under the title on the welcome screen. Defaults to the server's app.description. */
  readonly description = input<string>();
  /** Starter prompts for an empty conversation. Defaults to the server's app.suggestions. */
  readonly suggestions = input<string[]>();
  readonly placeholder = input<string>();
  readonly theme = input<"auto" | "light" | "dark">("auto");
  readonly showHeader = input(true, { transform: booleanAttribute });
  /** Show model, tokens and cost under each answer. */
  readonly showMeta = input(false, { transform: booleanAttribute });
  /** What the person has open (the record on screen, the selected rows). Sent to the model only. */
  readonly context = input<string>();
  /** A UI block asked the host app to do something (kind: "event"). */
  readonly action = output<UiAction>();

  protected readonly tag = "kl-agent-chat";
  protected readonly insideRoot = inject(INSIDE_ROOT, { skipSelf: true });
  private readonly composer = viewChild.required(Composer);
  protected readonly state = computed(() => agentState(this.store)(), { equal: () => false });
  protected readonly heading = computed(() => this.title() ?? this.state().config?.app.name ?? this.i18n().t("chat.defaultTitle"));
  protected readonly welcomeText = computed(() => this.description() ?? this.state().config?.app.description);
  protected readonly sessionTitle = computed(() => selectCurrentSession(this.state())?.title);
  protected readonly suggestionList = computed(() => this.suggestions() ?? this.state().config?.app.suggestions ?? []);
  protected readonly acceptImages = computed(() => {
    const state = this.state();
    return Boolean(selectCurrentModel(state)?.input.includes("image")) && Boolean(state.config?.features.attachments);
  });

  readonly actions: ChatActions = {
    sendPrompt: (text) => void this.store.send(text),
    emitAction: (action) => this.action.emit(action),
  };

  constructor() {
    super();
    effect((onCleanup) => {
      const context = this.context();
      if (context === undefined) return;
      this.store.setContext(context);
      onCleanup(() => this.store.setContext(undefined));
    });
  }

  focus() {
    this.composer().focus();
  }

  /** Puts text in the message box, ready to edit and send. */
  setDraft(text: string) {
    this.composer().setText(text);
  }

  protected send({ text, attachments, references }: ComposerSend) {
    void this.store.send(text, attachments, references);
  }
}
