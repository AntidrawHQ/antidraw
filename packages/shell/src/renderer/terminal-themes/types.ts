import type { ITheme } from "@xterm/xterm";

export type TerminalTheme = {
  name: string;
  theme: ITheme;
};

// Ghostty → xterm palette mapping (for porting Ghostty themes by hand):
//
//   Ghostty `palette = N=#hex`   →   xterm ITheme key
//   0  →  black           8  →  brightBlack
//   1  →  red             9  →  brightRed
//   2  →  green          10  →  brightGreen
//   3  →  yellow         11  →  brightYellow
//   4  →  blue           12  →  brightBlue
//   5  →  magenta        13  →  brightMagenta
//   6  →  cyan           14  →  brightCyan
//   7  →  white          15  →  brightWhite
//
// Other Ghostty keys:
//   background            →  background
//   foreground            →  foreground
//   cursor-color          →  cursor
//   cursor-text           →  cursorAccent
//   selection-background  →  selectionBackground
//   selection-foreground  →  selectionForeground
