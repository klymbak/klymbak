import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Applies Vue's transition classes (`<name>-enter-from`, `-enter-active`, `-enter-to`, and the same for
 * leave) to an element that stays mounted, so the shared stylesheet animates both bindings alike.
 * Returns whether the element should be displayed: it stays visible until it has finished leaving.
 */
export function useTransition(ref: RefObject<HTMLElement | null>, show: boolean, name: string, appear = false): boolean {
  const [rendered, setRendered] = useState(show);
  // The state the element was last animated to; with `appear`, the first render animates in.
  const shown = useRef(appear ? !show : show);
  const cancel = useRef<() => void>(undefined);

  useLayoutEffect(() => {
    if (show) setRendered(true);
    const el = ref.current;
    if (!el || shown.current === show) return;
    shown.current = show;
    cancel.current?.();

    if (show) el.style.removeProperty("display");
    const phase = show ? "enter" : "leave";
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
    };
    const finish = () => {
      // Hide a finished leave at once, so it can't flash back before React re-renders without it.
      if (!show) el.style.display = "none";
      stop();
      if (!show) setRendered(false);
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === el) finish();
    };
    el.addEventListener("transitionend", onEnd);
    // In case no transition runs (reduced motion, a missing rule, or a page that isn't painting).
    const fallback = setTimeout(finish, 600);
    cancel.current = stop;
    // No effect cleanup: StrictMode re-runs effects on mount and would cancel an appear transition.
    // The next transition cancels this one, and one still running at unmount only touches a detached element.
  }, [show, name, ref]);

  return show || rendered;
}
