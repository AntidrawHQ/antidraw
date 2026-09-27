/* ────────────────────────────────────────────────────────────
   Stacking order for the app's fixed surfaces. None of their
   ancestors creates a stacking context, so these z-indexes are
   compared directly. Kept as literal class strings so Tailwind
   finds them.
   ──────────────────────────────────────────────────────────── */

export const LAYER = {
  // Panels that slide over the canvas (the code side panel).
  sidePanel: "z-[100]",
  // Results the user must see whatever panel is open: the publish
  // panel, the published toast and its Details dialog.
  overlay: "z-[110]",
} as const;

// The z-index a class list sets, or null when it sets none.
export const zIndexOf = (className: string): number | null => {
  const match = /(?:^|\s)z-(?:\[(-?\d+)\]|(\d+))(?=\s|$)/.exec(className);
  if (!match) return null;
  return Number(match[1] ?? match[2]);
};
