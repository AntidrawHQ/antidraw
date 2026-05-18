import { useEffect, useRef } from "react";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/700.css";
import { getBuffer, subscribeLive } from "./store/terminals";
import { resolveTheme } from "./terminal-themes";
import { useTerminalSettings } from "./store/terminal-settings";

// Bare terminal — no chrome, no header. Drop into a sidebar slot and let the
// parent provide its own header / row management.
//
// State (PTY output buffer, live subscribers, title) lives in the terminals
// store as plain module state and runs independently of React. This component
// is a pure attach/detach view: on mount it replays the buffer and subscribes
// to live updates; on unmount it disposes xterm. PTY keeps running.
//
// Hardcoded:
//   antidraw theme (matches packages/shell neutral-800 surface)
//   Geist Mono 14px / 400 weight / 1.0 line-height
//   block cursor, blink on
//   WebGL renderer (DOM fallback on context loss)
//   10k scrollback
//   macOption-as-alt

type TerminalProps = {
  sessionId: string;
  className?: string;
  autoFocus?: boolean;
};

const FONT_FAMILY =
  '"Geist Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';

export const Terminal = ({
  sessionId,
  className = "h-full w-full",
  autoFocus = true,
}: TerminalProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTermType | null>(null);
  const fitRef = useRef<FitAddonType | null>(null);
  const activeThemeId = useTerminalSettings((s) => s.activeThemeId);
  const theme = resolveTheme(activeThemeId).theme;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let term: XTermType | null = null;
    let fit: FitAddonType | null = null;
    let ro: ResizeObserver | null = null;
    let onDataDispose: { dispose: () => void } | null = null;
    let onResizeDispose: { dispose: () => void } | null = null;
    let offLive: (() => void) | null = null;

    const setup = async () => {
      try {
        const [{ Terminal: XTerm }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
          import("@xterm/xterm"),
          import("@xterm/addon-fit"),
          import("@xterm/addon-web-links"),
        ]);
        if (disposed || !container) return;

        term = new XTerm({
          fontFamily: FONT_FAMILY,
          fontSize: 14,
          fontWeight: 400,
          fontWeightBold: 700,
          lineHeight: 1,
          letterSpacing: 0,
          cursorStyle: "block",
          cursorBlink: true,
          cursorInactiveStyle: "outline",
          scrollback: 10000,
          drawBoldTextInBrightColors: true,
          macOptionIsMeta: true,
          rightClickSelectsWord: true,
          theme,
          allowProposedApi: true,
          allowTransparency: false,
        });
        termRef.current = term;

        fit = new FitAddon();
        fitRef.current = fit;
        term.loadAddon(fit);
        term.loadAddon(new WebLinksAddon());
        term.open(container);

        // WebGL renderer — paints to a single canvas via glyph atlas. Falls
        // back to xterm's DOM renderer silently if the context can't init.
        try {
          const { WebglAddon } = await import("@xterm/addon-webgl");
          const webgl = new WebglAddon();
          webgl.onContextLoss(() => {
            try {
              webgl.dispose();
            } catch {
              /* noop */
            }
          });
          term.loadAddon(webgl);
        } catch {
          /* DOM renderer is the fallback, no action needed */
        }

        try {
          fit.fit();
        } catch {
          /* not yet sized */
        }

        // Replay everything the PTY emitted before we attached. xterm parses
        // these bytes synchronously to reconstruct the visible screen state.
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

  // Apply theme changes to the live xterm instance without tearing it down.
  // The setup effect above intentionally captures `theme` once at mount; any
  // subsequent change flows through here.
  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = theme;
  }, [theme]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ background: theme.background, padding: 10 }}
      onMouseDown={() => termRef.current?.focus()}
    />
  );
};
