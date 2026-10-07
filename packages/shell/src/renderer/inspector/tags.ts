import type { ElementContext, ElementInfo, Sides } from "@antidrawapp/runtime/inspector";
import { frameUrl, getElementContext } from "./bridge";
import { useInspectorStore, type Picked } from "./store";

// Tagged elements as the agent reads them, at the top of the message,
// grouped by the component whose frame they were picked in. The system
// prompt (main/api/claude-code-ops.ts) says what each line means.

// Where a frame's component is written (see main/api/services/component.service.ts).
const componentFile = (frame: string) => `src/components/user-components/${frame}.tsx`;

export const elementName = (info: ElementInfo) =>
  info.tag + (info.id ? `#${info.id}` : "") + info.classes.map((c) => `.${c}`).join("");

// Inside the block, nothing may read as a tag.
const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const quote = (v: string) => JSON.stringify(v);

// As CSS writes them: "8", "8 16", "8 16 4", "8 16 4 0". Nothing when all are 0.
const sides = (name: string, [top, right, bottom, left]: Sides) => {
  if (!top && !right && !bottom && !left) return null;
  const values =
    top === bottom && right === left
      ? top === right
        ? [top]
        : [top, right]
      : right === left
        ? [top, right, bottom]
        : [top, right, bottom, left];
  return `${name} ${values.map((v) => Math.round(v * 10) / 10).join(" ")}`;
};

const attr = (name: string, value: string | null | undefined) => (value ? ` ${name}=${quote(escape(value))}` : "");

const lines = (...all: (string | null | false)[]) => all.filter((l): l is string => !!l).map(escape);

export function describeContext(c: ElementContext) {
  return [
    "<element>",
    ...lines(
      `element: ${c.element}${c.text ? ` ${quote(c.text)}` : ""}`,
      c.loc
        ? `written at: ${c.loc}`
        : c.within && `written at: none of its own; inside ${c.within.loc}, at ${c.within.path}`,
      c.components.length > 0 &&
        `rendered by: ${c.components.map((x) => (x.loc ? `${x.name} (${x.loc})` : x.name)).join(" > ")}`,
      c.repeat &&
        `repeated: item ${c.repeat.index + 1} of ${c.repeat.count} rendered from there` +
          (c.repeat.keys.length
            ? `, ${c.repeat.keys.length > 1 ? "keys" : "key"} ${c.repeat.keys.map(quote).join(" > ")}`
            : ""),
      Object.keys(c.attributes).length > 0 &&
        `attributes: ${Object.entries(c.attributes)
          .map(([k, v]) => `${k}=${quote(v)}`)
          .join(" ")}`,
      `box: ${[c.size.join("×"), sides("margin", c.margin), sides("border", c.border), sides("padding", c.padding)]
        .filter(Boolean)
        .join(", ")}`,
    ),
    "</element>",
  ].join("\n");
}

// A pick its frame couldn't describe (closed, reloading, or the element is
// gone): what the canvas last knew.
export function describeLastSeen({ frame, info }: Picked) {
  return [
    "<element>",
    ...lines(
      `element: ${elementName(info)}${info.text ? ` ${quote(info.text)}` : ""}`,
      info.ref.loc && `written at: ${info.ref.loc}`,
      info.callsite && info.callsite !== info.ref.loc && `used at: ${info.callsite}`,
      "(as last seen: the frame didn't answer)",
    ),
    "</element>",
  ].join("\n");
}

// Picks with what their frames said about them (null: nothing), grouped by
// frame in the order they were first picked.
export function describeTags(picks: { pick: Picked; context: ElementContext | null }[]) {
  const frames = [...new Set(picks.map((p) => p.pick.frame))];
  return [
    "<canvas-selection>",
    ...frames.flatMap((frame) => {
      const inFrame = picks.filter((p) => p.pick.frame === frame);
      const viewport = inFrame.find((p) => p.context)?.context?.viewport;
      return [
        `<component${attr("name", frame)}${attr("file", componentFile(frame))}${attr("preview", frameUrl(frame))}${attr("frame", viewport?.join("×"))}>`,
        ...inFrame.map((p) => (p.context ? describeContext(p.context) : describeLastSeen(p.pick))),
        "</component>",
      ];
    }),
    "</canvas-selection>",
  ].join("\n");
}

// Empties the tags into a block for the message being sent.
export async function takeTags() {
  const { tags, setTags } = useInspectorStore.getState();
  if (!tags.length) return "";
  setTags([]);
  const contexts = await getElementContext(tags);
  return describeTags(tags.map((pick, i) => ({ pick, context: contexts[i] ?? null })));
}
