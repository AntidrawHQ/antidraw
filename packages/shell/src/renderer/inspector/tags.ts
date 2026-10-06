import type { ElementInfo } from "@antidrawapp/runtime/inspector";
import { refresh } from "./bridge";
import { useInspectorStore, type Picked } from "./store";

// Tagged elements as the agent reads them, at the top of the message.

export const elementName = (info: ElementInfo) =>
  info.tag + (info.id ? `#${info.id}` : "") + info.classes.map((c) => `.${c}`).join("");

const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function describeTag({ frame, info }: Picked) {
  const attrs: [string, string | null][] = [
    ["component", frame],
    ["loc", info.ref.loc],
    // Where the previewed component used it, when it's written elsewhere.
    ["callsite", info.callsite !== info.ref.loc ? info.callsite : null],
    ["element", elementName(info)],
    ["text", info.text || null],
    // Without a source location, all there is to go on.
    ["path", info.ref.loc ? null : info.ref.path.join("/")],
  ];
  return `<element ${attrs
    .filter((a): a is [string, string] => !!a[1])
    .map(([k, v]) => `${k}="${escape(v)}"`)
    .join(" ")} />`;
}

export const describeTags = (tags: Picked[]) =>
  tags.length ? ["<canvas-selection>", ...tags.map(describeTag), "</canvas-selection>"].join("\n") : "";

// Empties the tags into a block for the message being sent, with each element
// as its frame sees it now.
export async function takeTags() {
  const { tags, setTags } = useInspectorStore.getState();
  if (!tags.length) return "";
  setTags([]);
  return describeTags(await refresh(tags));
}
