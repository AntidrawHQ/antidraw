import { useEffect, useRef } from "react";
import type { Terminal as GhosttyTerminal, ITheme, FitAddon as FitAddonType } from "ghostty-web";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/700.css";
import { getBuffer, subscribeLive } from "./store/terminals";

// Bare terminal — no chrome, no header. Drop into a sidebar slot and let the
// parent provide its own header / row management.
//
// State (PTY output buffer, live subscribers, title) lives in the terminals
// store as plain module state and runs independently of React. This component
// is a pure attach/detach view: on mount it replays the buffer and subscribes
// to live updates; on unmount it disposes the terminal. PTY keeps running.
//
// Renderer: ghostty-web (Ghostty's VT parser compiled to WASM + a canvas
// renderer). xterm.js-compatible surface for write/onData/onResize/dispose.
//
// Hardcoded:
//   antidraw theme (matches packages/shell neutral-800 surface)
//   Geist Mono 14px / 400 weight / 1.0 line-height
//   block cursor, blink on
//   10k scrollback

type TerminalProps = {
  sessionId: string;
  className?: string;
  autoFocus?: boolean;
};

const ANTIDRAW_THEME: ITheme = {
  background: "#262626",
  foreground: "#fafafa",
  cursor: "#818cf8",
  cursorAccent: "#262626",
  selectionBackground: "#525252",
  black: "#262626",
  red: "#ef4444",
  green: "#14b8a6",
  yellow: "#eab308",
  blue: "#6366f1",
  magenta: "#a855f7",
  cyan: "#06b6d4",
  white: "#d4d4d4",
  brightBlack: "#525252",
  brightRed: "#f87171",
  brightGreen: "#2dd4bf",
  brightYellow: "#fbbf24",
  brightBlue: "#818cf8",
  brightMagenta: "#c084fc",
  brightCyan: "#22d3ee",
  brightWhite: "#fafafa",
};

const FONT_FAMILY =
  '"Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

export const Terminal = ({
  sessionId,
  className = "h-full w-full",
  autoFocus = true,
}: TerminalProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<GhosttyTerminal | null>(null);
  const fitRef = useRef<FitAddonType | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let term: GhosttyTerminal | null = null;
    let fit: FitAddonType | null = null;
    let ro: ResizeObserver | null = null;
    let onDataDispose: { dispose: () => void } | null = null;
    let onResizeDispose: { dispose: () => void } | null = null;
    let offLive: (() => void) | null = null;

    const setup = async () => {
      try {
        const { init, Terminal: GTerm, FitAddon } = await import("ghostty-web");

        // Idempotent — loads the WASM module on first call, no-op after.
        await init();
        if (disposed || !container) return;

        term = new GTerm({
          fontFamily: FONT_FAMILY,
          fontSize: 14,
          cursorStyle: "block",
          cursorBlink: true,
          scrollback: 10000,
          theme: ANTIDRAW_THEME,
          allowTransparency: false,
        });
        termRef.current = term;

        fit = new FitAddon();
        fitRef.current = fit;
        term.loadAddon(fit);
        term.open(container);

        try {
          fit.fit();
        } catch {
          /* not yet sized */
        }

        // Replay everything the PTY emitted before we attached. The terminal
        // parses these bytes synchronously to reconstruct the visible screen
        // state (cursor pos, alt screen, colors, scroll region).
        const history = getBuffer(sessionId);
        if (history) term.write(history);

        // Live updates from now on flow through the store's subscriber set.
        offLive = subscribeLive(sessionId, (data) => {
          term?.write(data);
        });

        onDataDispose = term.onData((data) => {
          window.electronAPI.terminal.input(sessionId, data);
        });
        onResizeDispose = term.onResize(({ cols, rows }) => {
          window.electronAPI.terminal.resize(sessionId, cols, rows);
        });

        // Push initial dimensions — fit.fit() above may have changed cols/rows
        // from the 80x24 default used at session creation.
        if (term.cols > 0 && term.rows > 0) {
          window.electronAPI.terminal.resize(sessionId, term.cols, term.rows);
        }

        ro = new ResizeObserver(() => {
          try {
            fit?.fit();
          } catch {
            /* noop */
          }
        });
        ro.observe(container);

        if (autoFocus) term.focus();
      } catch (err) {
        console.error("[Terminal] init failed:", err);
      }
    };

    void setup();

    return () => {
      disposed = true;
      termRef.current = null;
      fitRef.current = null;
      try {
        offLive?.();
      } catch {
        /* noop */
      }
      try {
        onDataDispose?.dispose();
      } catch {
        /* noop */
      }
      try {
        onResizeDispose?.dispose();
      } catch {
        /* noop */
      }
      try {
        ro?.disconnect();
      } catch {
        /* noop */
      }
      try {
        term?.dispose();
      } catch {
        /* noop */
      }
    };
  }, [sessionId, autoFocus]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ background: ANTIDRAW_THEME.background, padding: 10 }}
      onMouseDown={() => termRef.current?.focus()}
    />
  );
};
