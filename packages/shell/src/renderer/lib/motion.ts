// The chat's motion recipe: measured-pixel collapses on one 400ms plain CSS
// ease. SMOOTH carries the curve as Tailwind classes; EXIT_MS is the same
// duration for the JS that waits on it.

export const SMOOTH = "duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]";

export const EXIT_MS = 400;

// CSS cannot transition from height:auto. Pin the element to its measured
// height, commit that, then set 0 — the element's own `transition-[height]`
// class animates the rest.
export const collapseHeight = (el: HTMLElement | undefined | null) => {
  if (!el) return;
  el.style.height = `${el.offsetHeight}px`;
  void el.offsetHeight; // commit the pinned height before collapsing
  el.style.height = "0px";
};
