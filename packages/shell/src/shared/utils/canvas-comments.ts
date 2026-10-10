// Comments as the agent reads them: the whole first message of the chat a
// Send opens. The new comments, each with the component it was left on and
// the element under its pin, then the earlier sets with Claude's notes, so
// "undo that" or "same as the title" still works in a new chat. The system
// prompt (main/api/claude-code-ops.ts) says what each part means, and how to
// report back.

// Inside the block, nothing may read as a tag. Only "<" is escaped, as in
// the renderer's <canvas-selection> (renderer/inspector/tags.ts).
const escape = (v: string) => v.replace(/</g, "&lt;");
const unescape = (v: string) => v.replace(/&lt;/g, "<");
const attr = (name: string, value: string | null | undefined) =>
  value ? ` ${name}=${JSON.stringify(escape(value))}` : "";

// Where a frame's component is written (see main/api/services/component.service.ts).
export const componentFile = (componentName: string) =>
  `src/components/user-components/${componentName}.tsx`;

// What the canvas says about a draft when it's sent: only its frame can.
export type CommentContext = {
  id: number;
  // The <element> block the canvas wrote for the element under the pin.
  element: string | null;
  // The URL the frame previews its component at.
  preview: string | null;
  // The frame's size ("1280×800"), which the element's box is read at.
  frame: string | null;
};

export type NewCommentInput = CommentContext & {
  componentName: string;
  x: number;
  y: number;
  text: string;
};

export type EarlierSet = {
  n: number;
  comments: { id: number; text: string; done: boolean; note: string | null }[];
};

export function describeComments(fresh: NewCommentInput[], earlier: EarlierSet[]) {
  const out = ["<canvas-comments>"];
  for (const c of fresh) {
    out.push(
      `<comment${attr("id", String(c.id))}${attr("component", c.componentName)}${attr("file", componentFile(c.componentName))}${attr("preview", c.preview)}${attr("frame", c.frame)}${attr("at", `${Math.round(c.x)},${Math.round(c.y)}`)}>`,
      escape(c.text),
      ...(c.element ? [c.element] : []),
      "</comment>",
    );
  }
  if (earlier.length) {
    out.push("<earlier>");
    for (const s of earlier) {
      out.push(`<chat${attr("n", String(s.n))}>`);
      for (const c of s.comments)
        out.push(
          `<comment${attr("id", String(c.id))}${attr("status", c.done ? "completed" : "not marked done")}${attr("note", c.note)}>${escape(c.text)}</comment>`,
        );
      out.push("</chat>");
    }
    out.push("</earlier>");
  }
  out.push("</canvas-comments>");
  return out.join("\n");
}

// A sent message read back into the comments it carried, for its bubble.
// Null when it isn't one.
const BLOCK_RE = /^<canvas-comments>\n([\s\S]*?)\n<\/canvas-comments>(?:\n\n|$)/;

export function splitComments(
  message: string,
): { comments: { component: string; text: string }[]; text: string } | null {
  const block = BLOCK_RE.exec(message);
  if (!block) return null;
  const comments: { component: string; text: string }[] = [];
  const lines = block[1]!.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "<earlier>") break;
    const open = /^<comment id="\d+" component=("(?:[^"\\]|\\.)*")/.exec(lines[i]!);
    if (!open) continue;
    // The text runs to its element, or the comment's end: it may span lines,
    // and none of them can start with "<".
    const text: string[] = [];
    while (++i < lines.length && lines[i] !== "<element>" && lines[i] !== "</comment>")
      text.push(lines[i]!);
    comments.push({
      component: unescape(JSON.parse(open[1]!) as string),
      text: unescape(text.join("\n")),
    });
  }
  return { comments, text: message.slice(block[0].length) };
}
