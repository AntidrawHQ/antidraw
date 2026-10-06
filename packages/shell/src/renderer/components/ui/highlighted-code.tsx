import {
  LineHighlighter,
  type Lang,
  type ThemedToken,
} from "@/renderer/lib/highlight";
import { cn } from "@/renderer/lib/utils";
import { memo, useEffect, useState } from "react";

// Shiki's fontStyle flags.
const ITALIC = 1;
const BOLD = 2;

// Lines per memoized chunk. A delta re-renders the chunk it lands in; the
// chunks above compare a few dozen references each and skip.
const CHUNK = 64;

// How long a streaming input can pause before its live tokenizer, a Wasm
// instance of its own, is let go. The next delta starts another.
const IDLE_MS = 1000;

type LineProps = {
  tokens: ThemedToken[] | null;
  text: string;
  number?: string;
  /** The gutter's width in digits, so every row's code starts at one column. */
  gutterCh?: number;
  className?: string;
};

// LineHighlighter keeps the arrays of lines an append didn't change, so the
// default shallow compare skips them.
const Line = memo(
  ({ tokens, text, number, gutterCh, className }: LineProps) => (
    // min-h keeps an empty line one line tall.
    <div className={cn("flex min-h-[1lh]", className)}>
      {number !== undefined && (
        <span
          className="shrink-0 select-none pr-3 text-right text-neutral-600"
          style={{ width: `calc(${gutterCh}ch + 0.75rem)` }}
        >
          {number}
        </span>
      )}
      <span className="min-w-0 flex-1">
        {/* Chromium copies an empty row as nothing, so copied code would lose
          its blank lines. A newline in the row keeps them. */}
        {text === ""
          ? "\n"
          : tokens
            ? tokens.map((t, i) => (
                <span
                  key={i}
                  style={{
                    color: t.color,
                    fontStyle: t.fontStyle! & ITALIC ? "italic" : undefined,
                    fontWeight: t.fontStyle! & BOLD ? 600 : undefined,
                  }}
                >
                  {t.content}
                </span>
              ))
            : text}
      </span>
    </div>
  ),
);
Line.displayName = "Line";

type ChunkProps = {
  start: number;
  lines: string[];
  tokens: ThemedToken[][] | null;
  numbers?: string[];
  gutterCh?: number;
  className?: string;
};

const sameItems = <T,>(
  a: readonly T[] | null | undefined,
  b: readonly T[] | null | undefined,
) =>
  a === b ||
  (!!a && !!b && a.length === b.length && a.every((item, i) => item === b[i]));

// Lines in fragments: each row stays a direct child of the code's root, for
// callers that style rows by position.
const Chunk = memo(
  ({ start, lines, tokens, numbers, gutterCh, className }: ChunkProps) => (
    <>
      {lines.map((text, i) => (
        <Line
          key={start + i}
          text={text}
          tokens={tokens?.[i] ?? null}
          number={numbers?.[i]}
          gutterCh={gutterCh}
          className={className}
        />
      ))}
    </>
  ),
  (a, b) =>
    a.start === b.start &&
    a.gutterCh === b.gutterCh &&
    a.className === b.className &&
    sameItems(a.lines, b.lines) &&
    sameItems(a.tokens, b.tokens) &&
    sameItems(a.numbers, b.numbers),
);
Chunk.displayName = "Chunk";

export type HighlightedCodeProps = {
  code: string;
  /** null renders the code plain. */
  lang: Lang | null;
  /** Lexed before the code and dropped (see CodeSegment). */
  prefix?: string;
  /** One label per line, drawn in a gutter (a Read result's line numbers). */
  lineNumbers?: string[];
  /** Applied to every line, for diff tints. */
  lineClassName?: string;
  className?: string;
};

/**
 * Code coloured synchronously with @pierre/highlights. While a tool input
 * streams in, each delta re-lexes only from the last line on and re-renders
 * only the chunk it lands in, so it costs the new text, not the whole input.
 * Inherits font and size from its container; tokens without a colour inherit
 * the text colour.
 */
export const HighlightedCode = memo(function HighlightedCode({
  code,
  lang,
  prefix = "",
  lineNumbers,
  lineClassName,
  className,
}: HighlightedCodeProps) {
  const [highlighter] = useState(() => new LineHighlighter());
  // Idempotent for the same input, so a repeated or discarded render is safe.
  const { lines, tokens } = highlighter.update(code, lang, prefix);
  const gutterCh = lineNumbers?.reduce((max, n) => Math.max(max, n.length), 0);

  useEffect(() => {
    const idle = setTimeout(() => highlighter.dispose(), IDLE_MS);
    return () => clearTimeout(idle);
  }, [highlighter, code]);
  useEffect(() => () => highlighter.dispose(), [highlighter]);

  const chunks = [];
  for (let start = 0; start < lines.length; start += CHUNK) {
    const end = start + CHUNK;
    chunks.push(
      <Chunk
        key={start}
        start={start}
        lines={lines.slice(start, end)}
        tokens={tokens?.slice(start, end) ?? null}
        numbers={lineNumbers?.slice(start, end)}
        gutterCh={gutterCh}
        className={lineClassName}
      />,
    );
  }
  return <div className={className}>{chunks}</div>;
});
