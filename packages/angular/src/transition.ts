import { DestroyRef, Directive, ElementRef, afterRenderEffect, inject, input, signal, untracked, type AnimationCallbackEvent } from "@angular/core";

/** The transition each element is running, so the next one can replace it (a toast dismissed while it enters). */
const running = new WeakMap<Element, () => void>();

/**
 * Runs one of Vue's transitions on an element (`<name>-enter-from`, `-enter-active`, `-enter-to`, and the same for
 * leave), so the shared stylesheet animates every binding alike. Calls `done` once it has finished, or after 600 ms
 * if no transition runs (reduced motion, a missing rule, or a page that isn't painting). A transition still running
 * on the element stops without finishing. Returns a function that does the same to this one.
 */
export function runTransition(el: Element, phase: "enter" | "leave", name: string, done: () => void = () => undefined): () => void {
  running.get(el)?.();
  const from = `${name}-${phase}-from`;
  const active = `${name}-${phase}-active`;
  const to = `${name}-${phase}-to`;
  el.classList.add(from, active);
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => {
      el.classList.remove(from);
      el.classList.add(to);
    });
  });
  const stop = () => {
    cancelAnimationFrame(frame);
    clearTimeout(fallback);
    el.removeEventListener("transitionend", onEnd);
    el.classList.remove(from, active, to);
    if (running.get(el) === stop) running.delete(el);
  };
  // Done first: a finished leave is hidden or removed before its classes go, so it can't flash back.
  const finish = () => {
    done();
    stop();
  };
  const onEnd = (event: Event) => {
    if (event.target === el) finish();
  };
  el.addEventListener("transitionend", onEnd);
  const fallback = setTimeout(finish, 600);
  running.set(el, stop);
  return stop;
}

/** For `(animate.enter)` and `(animate.leave)`: runs the named transition and tells Angular when it is over. */
export function animateWith(name: string, phase: "enter" | "leave") {
  return (event: AnimationCallbackEvent) => runTransition(event.target, phase, name, () => event.animationComplete());
}

/**
 * Shows and hides an element that stays mounted, like Vue's v-show inside <Transition>:
 * `<div [klTransition]="open" klTransitionName="kl-widget">`. It stays visible until it has finished leaving.
 */
@Directive({
  selector: "[klTransition]",
  host: { "[style.display]": "(hidden() ?? !show()) ? 'none' : null" },
})
export class KlTransition {
  readonly show = input.required<boolean>({ alias: "klTransition" });
  readonly name = input.required<string>({ alias: "klTransitionName" });
  /** Set once the first render is done; until then the element follows `show` without animating. */
  protected readonly hidden = signal<boolean | undefined>(undefined);

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    // The state the element was last animated to.
    let shown: boolean | undefined;
    let cancel: (() => void) | undefined;
    inject(DestroyRef).onDestroy(() => cancel?.());

    afterRenderEffect(() => {
      const show = this.show();
      if (shown === undefined) {
        shown = show;
        this.hidden.set(!show);
        return;
      }
      if (show === shown) return;
      shown = show;
      if (show) {
        el.style.removeProperty("display");
        this.hidden.set(false);
      }
      cancel = runTransition(el, show ? "enter" : "leave", untracked(this.name), () => {
        if (show) return;
        el.style.display = "none";
        this.hidden.set(true);
      });
    });
  }
}
