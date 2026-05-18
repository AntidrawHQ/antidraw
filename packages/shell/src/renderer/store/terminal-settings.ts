import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_THEME_ID, type ThemeId } from "../terminal-themes";

type TerminalSettings = {
  activeThemeId: ThemeId;
  setActiveThemeId: (id: ThemeId) => void;
};

export const useTerminalSettings = create<TerminalSettings>()(
  persist(
    (set) => ({
      activeThemeId: DEFAULT_THEME_ID,
      setActiveThemeId: (id) => set({ activeThemeId: id }),
    }),
    {
      name: "antidraw:terminal-settings",
    },
  ),
);
