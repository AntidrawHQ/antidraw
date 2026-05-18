import { antidraw } from "./antidraw";
import { tokyoNight } from "./tokyo-night";

export type { TerminalTheme } from "./types";

// Add new themes here. To hand-port a Ghostty theme, create a sibling file
// (e.g. `dracula.ts`), follow the mapping comments in `types.ts`, then
// register it in this object. The keys are the theme ids persisted in the
// store, so don't rename them casually.
export const themes = {
  antidraw,
  "tokyo-night": tokyoNight,
} as const;

export type ThemeId = keyof typeof themes;

export const DEFAULT_THEME_ID: ThemeId = "antidraw";

export const resolveTheme = (id: string) => {
  return (themes as Record<string, (typeof themes)[ThemeId]>)[id] ?? themes[DEFAULT_THEME_ID];
};
