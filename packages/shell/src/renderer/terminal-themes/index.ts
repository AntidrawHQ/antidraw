import { antidraw } from "./antidraw";

export type { TerminalTheme } from "./types";

// Add new themes here. To hand-port a Ghostty theme, create a sibling
// file (e.g. `tokyonight.ts`), follow the mapping comments in `types.ts`,
// import it below, and point `activeTheme` at it.
export const themes = {
  antidraw,
} as const;

export const activeTheme = antidraw;
