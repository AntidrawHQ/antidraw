// Streaming scanner for OSC window-title escape sequences:
//
//   \e]0;<title>\a       (BEL terminator, most common)
//   \e]0;<title>\e\\     (ST terminator)
//   \e]1;<title>...      icon name only
//   \e]2;<title>...      window title only
//
// State persists across chunks so a sequence split across pty.onData boundaries
// is still parsed correctly. Buffer length is capped to defend against
// malformed input that never terminates.

const MAX_TITLE_LENGTH = 2048;

const parseOscTitle = (s: string): string | null => {
  const semi = s.indexOf(";");
  if (semi < 0) return null;
  const code = s.slice(0, semi);
  if (code !== "0" && code !== "1" && code !== "2") return null;
  return s.slice(semi + 1).trim();
};

type ScannerState = "idle" | "esc" | "osc" | "osc_esc";

export type TitleScanner = (data: string) => string | null;

export const createTitleScanner = (): TitleScanner => {
  let state: ScannerState = "idle";
  let buf = "";

  return (data: string): string | null => {
    let title: string | null = null;

    for (let i = 0; i < data.length; i++) {
      const ch = data.charCodeAt(i);

      switch (state) {
        case "idle":
          if (ch === 0x1b) state = "esc";
          break;

        case "esc":
          if (ch === 0x5d) {
            // ']' — OSC starts here
            state = "osc";
            buf = "";
          } else if (ch === 0x1b) {
            // Stay in esc — another ESC arrived
          } else {
            state = "idle";
          }
          break;

        case "osc":
          if (ch === 0x07) {
            // BEL terminator
            const t = parseOscTitle(buf);
            if (t !== null) title = t;
            buf = "";
            state = "idle";
          } else if (ch === 0x1b) {
            state = "osc_esc";
          } else if (buf.length < MAX_TITLE_LENGTH) {
            buf += data[i];
          }
          break;

        case "osc_esc":
          if (ch === 0x5c) {
            // '\' — ST terminator (ESC \)
            const t = parseOscTitle(buf);
            if (t !== null) title = t;
            buf = "";
            state = "idle";
          } else {
            // False alarm; abandon this OSC.
            buf = "";
            state = "idle";
          }
          break;
      }
    }

    return title;
  };
};
