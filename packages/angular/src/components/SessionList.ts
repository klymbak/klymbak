import { ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, output, signal, viewChild } from "@angular/core";
import type { SessionSummary } from "@klymbak/protocol";
import { injectAgentState, injectStoreRef } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";

const DAY = 86_400_000;

@Component({
  selector: "kl-session-list",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let s = state();
    <div class="kl-sessions">
      <button type="button" class="kl-btn kl-sessions__new" (click)="startNew()"><svg klIcon name="plus" [size]="14" /> New conversation</button>
      @if (s.sessions.length > 8) {
        <input #search class="kl-input" type="search" placeholder="Search conversations" aria-label="Search conversations" [value]="query()" (input)="query.set(search.value)" />
      }
      @if (!s.sessions.length) {
        <p class="kl-sessions__empty">Your conversations will appear here.</p>
      }
      @for (group of groups(); track group.label) {
        <nav class="kl-sessions__group" [attr.aria-label]="group.label">
          <span class="kl-sessions__label">{{ group.label }}</span>
          @for (session of group.items; track session.id) {
            <div class="kl-session" [class.kl-session--active]="session.id === s.sessionId">
              @if (renaming() === session.id) {
                <input
                  #rename
                  class="kl-input kl-session__rename"
                  aria-label="Conversation title"
                  [value]="draft()"
                  (input)="draft.set(rename.value)"
                  (keydown.enter)="commitRename()"
                  (keydown.escape)="stopRename()"
                  (blur)="commitRename()"
                />
              } @else {
                <button type="button" class="kl-session__open" [title]="session.title" (click)="openSession(session.id)">
                  @if (session.running) {
                    <span class="kl-spinner kl-session__icon"></span>
                  } @else if (session.source === "schedule") {
                    <svg klIcon class="kl-session__icon" name="clock" [size]="13" />
                  }
                  <span class="kl-session__title">{{ session.title }}</span>
                  @if (session.unread) {
                    <span class="kl-session__unread" aria-label="Unread"></span>
                  }
                </button>
              }
              @if (confirming() === session.id) {
                <span class="kl-session__confirm">
                  <button type="button" class="kl-btn kl-btn--sm kl-btn--danger" (click)="remove(session.id)">Delete</button>
                  <button type="button" class="kl-btn kl-btn--sm kl-btn--ghost" (click)="confirming.set(null)">Keep</button>
                </span>
              } @else if (renaming() !== session.id) {
                <span class="kl-session__tools">
                  <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" aria-label="Rename" (click)="startRename(session)">
                    <svg klIcon name="edit" [size]="13" />
                  </button>
                  <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" aria-label="Delete" (click)="confirming.set(session.id)">
                    <svg klIcon name="trash" [size]="13" />
                  </button>
                </span>
              }
            </div>
          }
        </nav>
      }
    </div>
  `,
})
export class SessionList {
  /** A conversation was opened, or "" for a new one. */
  readonly open = output<string>();
  private readonly store = injectStoreRef();
  protected readonly state = injectAgentState();
  protected readonly query = signal("");
  protected readonly renaming = signal<string | null>(null);
  protected readonly draft = signal("");
  protected readonly confirming = signal<string | null>(null);
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>("rename");
  // Read at call time: the blur that follows Enter or Escape must see that renaming already ended.
  private editing: string | null = null;

  protected readonly groups = computed(() => {
    const q = this.query().trim().toLowerCase();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = startOfDay.getTime();
    const buckets: { label: string; items: SessionSummary[] }[] = [
      { label: "Today", items: [] },
      { label: "Yesterday", items: [] },
      { label: "Previous 7 days", items: [] },
      { label: "Older", items: [] },
    ];
    for (const session of this.state().sessions) {
      if (q && !`${session.title} ${session.preview ?? ""}`.toLowerCase().includes(q)) continue;
      const t = session.updatedAt;
      const bucket = t >= today ? 0 : t >= today - DAY ? 1 : t >= today - 7 * DAY ? 2 : 3;
      buckets[bucket]!.items.push(session);
    }
    return buckets.filter((b) => b.items.length);
  });

  constructor() {
    afterRenderEffect(() => {
      if (this.renaming()) this.renameInput()?.nativeElement.select();
    });
  }

  protected startNew() {
    this.store().newSession();
    this.open.emit("");
  }

  protected openSession(id: string) {
    if (this.renaming()) return;
    void this.store().openSession(id);
    this.open.emit(id);
  }

  protected startRename(session: SessionSummary) {
    this.editing = session.id;
    this.renaming.set(session.id);
    this.draft.set(session.title);
  }

  protected stopRename() {
    this.editing = null;
    this.renaming.set(null);
  }

  protected commitRename() {
    const id = this.editing;
    this.stopRename();
    const title = this.draft().trim();
    if (id && title) void this.store().renameSession(id, title);
  }

  protected remove(id: string) {
    void this.store().deleteSession(id);
    this.confirming.set(null);
  }
}
