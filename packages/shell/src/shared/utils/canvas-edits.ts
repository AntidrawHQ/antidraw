// Design edits as the agent reads them: the whole message an Apply sends.
// Each element with the component it's in, the element as its frame saw it
// when it was first edited, and what changed on it, said as the panel says
// it and as the CSS that previewed it. The system prompt
// (main/api/claude-code-ops.ts) says what each part means.

import type { ElementContext, ElementInfo } from "../../agent/protocol";
import { changesOf, previewCss, type Style } from "../design";
import { componentFile } from "./canvas-comments";

// One element's edits, not yet applied: the styles it had (`base`) and has
// now in the panel. `seen` is what its frame said about it when it was first
// edited (null if it couldn't say). `name`: as the change list shows it,
// "button.cta".
export type EditedElement = {
  id: number;
  componentName: string;
  element: ElementInfo;
  name: string;
  text: boolean;
  base: Style;
  now: Style;
  seen: ElementContext | null;
};

// Edits handed to a chat by Apply: still shown on the canvas until the
// chat's turn ends, by when the code has them.
export type AppliedSet = { id: number; conversationId: string; edits: EditedElement[] };

export type EditList = { edits: EditedElement[]; applied: AppliedSet[] };

// What the canvas says about an edited element when it's applied: only its
// frame can.
export type EditContext = {
  id: number;
  // The <element> block the canvas wrote for it.
  block: string | null;
  // The URL the frame previews its component at.
  preview: string | null;
  // The frame's size ("1280×800"), which the element's box is read at.
  frame: string | null;
};

// Inside the block, nothing may read as a tag, and each change is one line:
// what the frame read (a weight, a shadow layer, the element's text) is the
// page's to say, so a line break in it reads as a space. As the renderer's
// <canvas-selection> (renderer/inspector/tags.ts), whose escape this is: "<",
// and an "&" only where it starts an escape's spelling.
const escape = (v: string) => v.replace(/&(?=lt;|amp;)/g, "&amp;").replace(/</g, "&lt;");
const line = (v: string) => escape(v.replace(/\r\n|[\r\n]/g, " "));
const unescape = (v: string) => v.replace(/&(lt|amp);/g, (_, e: string) => (e === "lt" ? "<" : "&"));
const attr = (name: string, value: string | null | undefined) =>
  value ? ` ${name}=${JSON.stringify(escape(value))}` : "";

export function describeEdits(edits: (EditedElement & EditContext)[]) {
  const out = ["<canvas-edits>"];
  for (const e of edits) {
    const css = Object.entries(previewCss(e.base, e.now))
      .map(([prop, value]) => `${prop}: ${value}`)
      .join("; ");
    out.push(
      `<edit${attr("id", String(e.id))}${attr("component", e.componentName)}${attr("file", componentFile(e.componentName))}${attr("preview", e.preview)}${attr("frame", e.frame)}>`,
      ...(e.block ? [e.block] : []),
      ...changesOf(e.base, e.now).map((c) => line(`${c.group.label}: ${c.from} → ${c.to}`)),
      line(`previewed as: ${css}`),
      "</edit>",
    );
  }
  out.push("</canvas-edits>");
  return out.join("\n");
}

// A sent message read back into the edits it carried, for its bubble: the
// component, and each change. Null when it isn't one.
const BLOCK_RE = /^<canvas-edits>\n([\s\S]*?)\n<\/canvas-edits>(?:\n\n|$)/;

export function splitEdits(
  message: string,
): { edits: { component: string; changes: string[] }[]; text: string } | null {
  const block = BLOCK_RE.exec(message);
  if (!block) return null;
  const edits: { component: string; changes: string[] }[] = [];
  let inElement = false;
  for (const line of block[1]!.split("\n")) {
    const open = /^<edit id="\d+" component=("(?:[^"\\]|\\.)*")/.exec(line);
    if (open) edits.push({ component: unescape(JSON.parse(open[1]!) as string), changes: [] });
    else if (line === "<element>") inElement = true;
    else if (line === "</element>") inElement = false;
    else if (!inElement && line !== "</edit>" && !line.startsWith("previewed as: ")) edits.at(-1)?.changes.push(unescape(line));
  }
  return { edits, text: message.slice(block[0].length) };
}
