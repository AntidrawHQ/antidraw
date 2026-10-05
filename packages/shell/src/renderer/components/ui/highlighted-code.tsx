import {
  highlight,
  type Lang,
  type ThemedToken,
} from "@/renderer/lib/highlight";
import { cn } from "@/renderer/lib/utils";
import { memo, useMemo } from "react";

// Shiki's fontStyle flags.
const ITALIC = 1;
const BOLD = 2;

const sameTokens = (a: ThemedToken[], b: ThemedToken[]) =>
  a.length === b.length &&
  a.every((t, i) => {
    const u = b[i];
    return (
      u !== undefined &&
      t.content === u.content &&
      t.color === u.color &&
      t.fontStyle === u.fontStyle
    );
  });

type LineProps = {
  tokens: ThemedToken[] | null;
  text: string;
  number?: string;
  /** The gutter's width in digits, so every row's code starts at one column. */
  gutterCh?: number;
  className?: string;
};

// While a tool input streams, every delta re-tokenizes the whole input, but
// only the last line or two actually changes. Comparing tokens by value lets
// the settled lines above skip rendering, so a delta costs a few spans of DOM
// work however long the file is.
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
  (a, b) =>
    a.text === b.text &&
    a.number === b.number &&
    a.gutterCh === b.gutterCh &&
    a.className === b.className &&
    (a.tokens === b.tokens ||
      (!!a.tokens && !!b.tokens && sameTokens(a.tokens, b.tokens))),
);
Line.displayName = "Line";

export type HighlightedCodeProps = {
  code: string;
  /** null renders the code plain. */
  lang: Lang | null;
  /** One label per line, drawn in a gutter (a Read result's line numbers). */
  lineNumbers?: string[];
  /** Applied to every line, for diff tints. */
  lineClassName?: string;
  className?: string;
};

/**
 * Code coloured synchronously with @pierre/highlights, cheap enough to re-run
 * on every delta of a streaming tool input. Inherits font and size from its
 * container; tokens without a colour inherit the text colour.
 */
export const HighlightedCode = memo(function HighlightedCode({
  code,
  lang,
  lineNumbers,
  lineClassName,
  className,
}: HighlightedCodeProps) {
  const tokens = useMemo(() => highlight(code, lang), [code, lang]);
  const lines = useMemo(() => code.split("\n"), [code]);
  const gutterCh = lineNumbers?.reduce((max, n) => Math.max(max, n.length), 0);

  return (
    <div className={className}>
      {lines.map((text, i) => (
        <Line
          key={i}
          text={text}
          tokens={tokens?.[i] ?? null}
          number={lineNumbers?.[i]}
          gutterCh={gutterCh}
          className={lineClassName}
        />
      ))}
    </div>
  );
});
