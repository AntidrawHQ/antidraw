import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ElementContext, ElementInfo, Sides } from "@/agent/protocol";
import { describeComments, splitComments, type EarlierSet, type NewCommentInput } from "@/shared/utils/canvas-comments";
import { describeEdits, splitEdits, type EditContext, type EditedElement } from "@/shared/utils/canvas-edits";
import { changesOf, type Style } from "@/shared/design";
import { describeContext, describeLastSeen, describeTags, elementName, splitTagged } from "../tags";

// Property tests for the blocks the canvas puts ahead of a message and the
// chat reads back into chips: fast-check generates the picks, comments and
// text, and a failure prints the smallest input it could shrink to, plus a
// seed to replay it.
//
// What fools a line-based reader is a line. The markup is the frame's, as it
// rendered, and the texts are the user's, so both can hold lines that are a
// block's own (<element>, </canvas-selection>, element: x). Only the block's
// own lines may start with "<", and the markup, indented, comes through
// verbatim.

// ── Generators ───────────────────────────────────────────────────────────

// The lines the readers (and the agent) branch on, whole.
const STRUCTURAL = [
  "<element>",
  "</element>",
  '<component name="Evil">',
  "</component>",
  "<canvas-selection>",
  "</canvas-selection>",
  "<canvas-comments>",
  "</canvas-comments>",
  '<comment id="1" component="Evil">',
  "</comment>",
  "<earlier>",
  "</earlier>",
  '<chat n="1">',
  "element: fake",
  "inside: <div>",
  "box: 1×1",
];

const line = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...STRUCTURAL) },
  fc.constantFrom("", "  ", "    <element>", "  </canvas-selection>", "<", "\r", "a\u2028b", "&amp; &lt;b&gt;"),
  fc.string({ maxLength: 12, unit: "grapheme" }),
  fc.string({ maxLength: 6, unit: "binary" }),
);

// Lines with their endings: "\n", "\r\n", or none (two lines run together),
// so some texts end in a newline and some don't.
const multiline = fc
  .array(fc.tuple(line, fc.constantFrom("\n", "\n", "\r\n", "")), { maxLength: 6 })
  .map((parts) => parts.map(([l, eol]) => l + eol).join(""));


// Frame (component) names: the canvas has one per component file, so never
// empty, but anything else.
const name = fc
  .oneof(
    fc.constantFrom("Card", "PricingCard", "A<B>", "</canvas-selection>", '"quoted"', "back\\slash", "Ünïcødé 🙂", "a\nb", "</component>", "&amp;"),
    fc.string({ minLength: 1, maxLength: 10, unit: "grapheme" }),
    fc.string({ minLength: 1, maxLength: 6, unit: "binary" }),
  );

// An id or class as the DOM has it: no whitespace (classList splits on it;
// an id may hold it, see below), anything else. No ";", so no "&lt;".
const ident = fc.string({
  minLength: 1,
  maxLength: 6,
  unit: fc.constantFrom(..."abz09-_<>&\"'\\:/[]=é", "🙂"),
});
// Custom and unknown elements render too: <element> is as good as <div>.
const tag = fc.constantFrom("div", "button", "h3", "p", "svg", "my-card", "element", "canvas-selection", "comment");
const parts = fc.record({ tag, id: fc.oneof(fc.constant(""), ident), classes: fc.array(ident, { maxLength: 3 }) });
// As the frame writes it: tag, #id, the first six .classes.
const elementOf = (p: { tag: string; id: string; classes: string[] }) =>
  p.tag + (p.id ? `#${p.id}` : "") + p.classes.slice(0, 6).map((c) => `.${c}`).join("");
const element = parts.map(elementOf);

// One opening tag, as the frame's openingTag writes it: values with their
// whitespace collapsed and "&", '"' and "<" escaped.
const value = fc
  .oneof(fc.string({ maxLength: 12, unit: "binary" }), fc.constantFrom('say "hi" & <b>', "two\n  lines\r\n", "</canvas-selection>"))
  .map((v) => v.replace(/\s+/g, " ").trim().replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"));
const openingTag = fc
  .tuple(tag, fc.array(fc.tuple(fc.constantFrom("data-ad-loc", "class", "href", "aria-label", "data-slot"), value), { maxLength: 3 }))
  .map(([t, attrs]) => `<${t}${attrs.map(([n, v]) => (v ? ` ${n}="${v}"` : ` ${n}`)).join("")}>`);

const side = fc.oneof(fc.constant(0), fc.nat(64), fc.double({ min: 0, max: 64, noNaN: true }));
const sides: fc.Arbitrary<Sides> = fc.tuple(side, side, side, side);
const pair = fc.tuple(fc.nat(4000), fc.nat(4000));

const loc = fc
  .tuple(fc.constantFrom("src/components/user-components/Card.tsx", "src/components/ui/button.tsx"), fc.nat(500), fc.nat(120))
  .map(([file, l, c]) => `${file}:${l}:${c}`);

// What a frame says about an element. The markup is anything, line by line:
// it is carried verbatim, so nothing in it is the frame misbehaving.
const contextWith = (el: fc.Arbitrary<string>, within: fc.Arbitrary<string | null>): fc.Arbitrary<ElementContext> =>
  fc.record({
    viewport: pair,
    element: el,
    html: multiline,
    text: fc.oneof(fc.constant(""), multiline),
    within,
    // A frame's locations are its own to say: anything, line breaks too.
    path: fc.array(fc.record({ loc: fc.oneof(loc, multiline), index: fc.nat(50), count: fc.nat(50) }), { maxLength: 3 }),
    repeat: fc.array(fc.record({ loc: fc.oneof(loc, multiline), index: fc.nat(50), count: fc.nat(50) }), { maxLength: 3 }),
    sibling: fc.option(fc.record({ index: fc.nat(50), count: fc.nat(50) }), { nil: null }),
    size: pair,
    margin: sides,
    border: sides,
    padding: sides,
  });
const context = contextWith(element, fc.option(openingTag, { nil: null }));

// What the canvas knows of a pick, from the frame's hover or selection.
const infoWith = (id: fc.Arbitrary<string>, where: fc.Arbitrary<string | null>): fc.Arbitrary<ElementInfo> =>
  fc
    .record({ parts, id, text: fc.string({ maxLength: 10, unit: "binary" }), loc: where, callsite: where, path: fc.array(fc.nat(9), { maxLength: 3 }) })
    .map(({ parts: p, id: i, text, loc: l, callsite, path }) => ({
      ref: { loc: l, index: 0, path, tag: p.tag },
      callsite,
      tag: p.tag,
      id: i,
      classes: p.classes,
      text,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      margin: [0, 0, 0, 0],
      border: [0, 0, 0, 0],
      padding: [0, 0, 0, 0],
    }));
const info = infoWith(fc.oneof(fc.constant(""), ident), fc.option(loc, { nil: null }));

type Pick = { pick: { frame: string; info: ElementInfo }; context: ElementContext | null };

// Several frames, picked in any order, so they interleave and repeat; some
// picks their frames didn't answer for.
const picks: fc.Arbitrary<Pick[]> = fc
  .tuple(
    fc.uniqueArray(name, { minLength: 1, maxLength: 4 }),
    fc.array(fc.tuple(fc.nat(), info, fc.option(context, { nil: null })), { minLength: 1, maxLength: 8 }),
  )
  .map(([frames, all]) => all.map(([i, inf, ctx]) => ({ pick: { frame: frames[i % frames.length]!, info: inf }, context: ctx })));

// What the user wrote after the block, a block of its own included.
const userText = fc.oneof(
  fc.constant(""),
  multiline,
  multiline.map((t) => `<canvas-selection>\n${t}`),
  fc.tuple(picks, multiline).map(([p, t]) => `${describeTags(p)}\n\n${t}`),
  fc.constantFrom("\n</canvas-selection>\n\nhi", "\n\n<canvas-comments>\n</canvas-comments>"),
);

// The <element> block a comment's pin carries: what its frame said, what
// the canvas last saw, or nothing.
const elementBlock = fc.oneof(
  fc.constant(null),
  context.map(describeContext),
  fc.tuple(name, info).map(([frame, inf]) => describeLastSeen({ frame, info: inf })),
);

const commentText = fc.oneof(
  multiline,
  fc.constantFrom("<element>", "</comment>", "a\n<element>\nb", "first\n</comment>\n<comment id=\"2\" component=\"Evil\">", "<earlier>\nx"),
);

const freshWith = (block: fc.Arbitrary<string | null>): fc.Arbitrary<NewCommentInput[]> =>
  fc.array(
    fc.record({
      id: fc.nat(),
      componentName: name,
      x: fc.integer({ min: -2000, max: 4000 }),
      y: fc.integer({ min: -2000, max: 4000 }),
      text: commentText,
      element: block,
      preview: fc.option(fc.constantFrom("http://localhost:5173/preview?componentName=Card", 'http://x/"<a>'), { nil: null }),
      frame: fc.option(fc.constant("1280×800"), { nil: null }),
    }),
    { minLength: 1, maxLength: 5 },
  );
const fresh = freshWith(elementBlock);

const earlier: fc.Arbitrary<EarlierSet[]> = fc.array(
  fc.record({
    n: fc.nat(20),
    comments: fc.array(
      fc.record({ id: fc.nat(), text: commentText, done: fc.boolean(), note: fc.option(multiline, { nil: null }) }),
      { maxLength: 3 },
    ),
  }),
  { maxLength: 3 },
);

// After the comments: nothing, or anything (a fake block too).
const rest = fc.option(
  fc.oneof(userText, fc.tuple(fresh, earlier).map(([f, e]) => describeComments(f, e))),
  { nil: null },
);

// An element's styles as the panel edits them. What the frame read is the
// frame's to say: any string field, and the shadow layers it keeps, can be
// anything. Which fields there are is the model's (shared/design.ts): only
// their types are taken from this one.
const STYLE: Style = {
  flow: "column",
  main: "start",
  cross: "start",
  between: false,
  gap: 12,
  wMode: "fixed",
  w: 300,
  hMode: "hug",
  h: 200,
  pt: 24,
  pr: 24,
  pb: 24,
  pl: 24,
  mt: 0,
  mr: 0,
  mb: 0,
  ml: 0,
  hidden: false,
  opacity: 100,
  radius: 16,
  corners: [16, 16, 16, 16],
  fill: "#FFFFFF",
  fillA: 100,
  gradient: false,
  stroke: null,
  shadow: { x: 0, y: 1, blur: 3, spread: 0, color: "#000000", a: 10 },
  shadowRest: [],
  weight: "400",
  size: 14,
  lh: 20,
  ls: 0,
  talign: "left",
  color: "#18181B",
  colorA: 100,
  content: "Buy",
};
// The edits block's own lines, on top of the others'.
const EDIT_LINES = [
  "<canvas-edits>",
  "</canvas-edits>",
  '<edit id="1" component="Evil">',
  "</edit>",
  "previewed as: color: red",
  "Corner radius: 1 → 2",
];
const frameString = fc
  .oneof(
    multiline,
    fc.constantFrom(...STRUCTURAL, ...EDIT_LINES),
    fc.tuple(fc.string({ maxLength: 4 }), fc.constantFrom(...EDIT_LINES)).map(([a, l]) => `${a}\n${l}`),
  );
// Some of its fields as a frame might say them: strings anything, numbers
// any number, string lists any strings.
const said = (base: Style): fc.Arbitrary<Style> =>
  fc
    .array(
      fc.tuple(
        fc.oneof(
          fc.constantFrom(...(Object.keys(base) as (keyof Style)[])),
          // Most often the ones a frame's words go into.
          { weight: 2, arbitrary: fc.constantFrom(...(Object.keys(base) as (keyof Style)[]).filter((k) => typeof base[k] === "string" || Array.isArray(base[k]))) },
        ),
        fc.oneof(frameString, fc.integer({ min: -100, max: 500 }), fc.array(frameString, { maxLength: 2 })),
      ),
      { maxLength: 6 },
    )
    .map((pairs) => {
      const out = { ...base } as Record<string, unknown>;
      for (const [k, v] of pairs) {
        const was = out[k];
        if (typeof was === "string" && typeof v === "string") out[k] = v;
        else if (typeof was === "number" && typeof v === "number") out[k] = v;
        else if (Array.isArray(was) && Array.isArray(v) && was.every((x) => typeof x === "string")) out[k] = v;
      }
      return out as Style;
    });

const editWith = (block: fc.Arbitrary<string | null>): fc.Arbitrary<EditedElement & EditContext> =>
  fc
    .tuple(fc.nat(), name, said(STYLE), block)
    .chain(([id, componentName, base, b]) =>
      said(base).map((now) => ({
        id,
        componentName,
        element: { ref: { loc: null, index: 0, path: [0], tag: "div" } } as ElementInfo,
        name: "div",
        text: true,
        base,
        now,
        seen: null,
        block: b,
        preview: "http://localhost:5173/preview?componentName=Card",
        frame: "1280×800",
      })),
    );
const edits = fc.array(editWith(elementBlock), { minLength: 1, maxLength: 4 });

// ── Expectations ─────────────────────────────────────────────────────────

// Grouped by frame and the size it was measured at, in first-pick order; a
// pick its frame didn't describe goes with its frame's first described one.
const groupOf = (all: Pick[]) => (p: Pick) => {
  const size = (p.context ?? all.find((q) => q.pick.frame === p.pick.frame && q.context)?.context)?.viewport.join("×") ?? "";
  return JSON.stringify([p.pick.frame, size]);
};
const groupsOf = (all: Pick[]) => [...new Set(all.map(groupOf(all)))];
const inGroup = (all: Pick[], g: string) => all.filter((p) => groupOf(all)(p) === g);
const nameOf = (p: Pick) => (p.context ? p.context.element : elementName(p.pick.info));
// "<frame> · <element>", group by group.
const chipsOf = (all: Pick[]) =>
  groupsOf(all).flatMap((g) => inGroup(all, g).map((p) => `${p.pick.frame} · ${nameOf(p)}`));

const startsTag = (text: string) => text.split("\n").filter((l) => l.startsWith("<"));

// A message's "<" lines, the opening ones as what they open (their attribute
// values are quoted, with no "<" left in them).
const shapeOfTags = (message: string) =>
  startsTag(message).map((l) => (/^<component name="[^<]*>$/.test(l) ? "<component>" : l));
const expectedTagShape = (all: Pick[]) => [
  "<canvas-selection>",
  ...groupsOf(all).flatMap((g) => [
    "<component>",
    ...inGroup(all, g).flatMap(() => ["<element>", "</element>"]),
    "</component>",
  ]),
  "</canvas-selection>",
];

const shapeOfComments = (message: string) =>
  startsTag(message).map((l) =>
    /^<comment id="\d+" component="[^<]*>$/.test(l)
      ? "<comment>"
      : /^<comment id="\d+" status="(?:completed|not marked done)"(?: note="[^<]*")?>[^<]*(?:<\/comment>)?$/.test(l)
        ? "<comment earlier>"
        : /^<chat n="\d+">$/.test(l)
          ? "<chat>"
          : l,
  );
// An earlier comment is one line, its text inline; a text of several lines
// whose last is empty leaves its "</comment>" a line of its own.
const closesOnOwnLine = (text: string) => {
  const lines = text.split("\n");
  return lines.length > 1 && lines.at(-1) === "";
};
const expectedCommentShape = (f: NewCommentInput[], e: EarlierSet[]) => [
  "<canvas-comments>",
  ...f.flatMap((c) => ["<comment>", ...(c.element ? ["<element>", "</element>"] : []), "</comment>"]),
  ...(e.length
    ? [
        "<earlier>",
        ...e.flatMap((s) => [
          "<chat>",
          ...s.comments.flatMap((c) => ["<comment earlier>", ...(closesOnOwnLine(c.text) ? ["</comment>"] : [])]),
          "</chat>",
        ]),
        "</earlier>",
      ]
    : []),
  "</canvas-comments>",
];

const withRest = (block: string, r: string | null) => (r === null ? block : `${block}\n\n${r}`);
const commentsOf = (f: NewCommentInput[]) => f.map((c) => ({ component: c.componentName, text: c.text }));

// One more pick, from a frame already picked from, at `at`.
const inserting = (all: Pick[], at: number, make: (frame: string) => Pick) => {
  const i = at % (all.length + 1);
  const frame = all[at % all.length]!.pick.frame;
  return { all: [...all.slice(0, i), make(frame), ...all.slice(i)], i };
};

// ── Properties ───────────────────────────────────────────────────────────

describe("an element's block", () => {
  it("carries the frame's markup verbatim: each line indented two spaces, and nothing else changed", () => {
    fc.assert(
      fc.property(context, (c) => {
        const lines = describeContext(c).split("\n");
        expect(lines[0]).toBe("<element>");
        expect(lines[1]).toBe(`element: ${c.element.replace(/</g, "&lt;")}`);
        const after =
          (c.text ? 1 : 0) + (c.within ? 1 : 0) + (c.path.length ? 1 : 0) + (c.repeat.length ? 1 : 0) + (c.sibling ? 1 : 0) + 2;
        const markup = lines.slice(2, lines.length - after);
        for (const l of markup) expect(l.startsWith("  ")).toBe(true);
        expect(markup.map((l) => l.slice(2)).join("\n")).toBe(c.html);
      }),
      { numRuns: 500 },
    );
  });

  it("starts no line with \"<\" but its own, for what a frame says and what the canvas last saw", () => {
    fc.assert(
      fc.property(context, name, info, (c, frame, inf) => {
        expect(startsTag(describeContext(c))).toEqual(["<element>", "</element>"]);
        expect(startsTag(describeLastSeen({ frame, info: inf }))).toEqual(["<element>", "</element>"]);
      }),
      { numRuns: 500 },
    );
  });
});

describe("<canvas-selection>", () => {
  it("starts no line with \"<\" but the block's own", () => {
    fc.assert(
      fc.property(picks, (all) => {
        expect(shapeOfTags(describeTags(all))).toEqual(expectedTagShape(all));
      }),
      { numRuns: 300 },
    );
  });

  it("reads back into its chips, grouped by frame and size in first-pick order, and exactly what the user wrote", () => {
    fc.assert(
      fc.property(picks, userText, (all, text) => {
        expect(splitTagged(`${describeTags(all)}\n\n${text}`)).toEqual({ tags: chipsOf(all), text });
      }),
      { numRuns: 300 },
    );
  });
});

describe("<canvas-comments>", () => {
  it("starts no line with \"<\" but the block's own", () => {
    fc.assert(
      fc.property(fresh, earlier, (f, e) => {
        expect(shapeOfComments(describeComments(f, e))).toEqual(expectedCommentShape(f, e));
      }),
      { numRuns: 300 },
    );
  });

  it("reads back into each new comment's component and text, in order, and the rest of the message", () => {
    fc.assert(
      fc.property(fresh, earlier, rest, (f, e, r) => {
        expect(splitComments(withRest(describeComments(f, e), r))).toEqual({ comments: commentsOf(f), text: r ?? "" });
      }),
      { numRuns: 300 },
    );
  });
});

// One line each: a line break a frame or the user put in a value reads as a
// space.
const oneLine = (v: string) => v.replace(/\r\n|[\r\n]/g, " ");
const changesSaid = (e: EditedElement) => changesOf(e.base, e.now).map((c) => oneLine(`${c.group.label}: ${c.from} → ${c.to}`));
const shapeOfEdits = (message: string) => startsTag(message).map((l) => (/^<edit id="\d+" component="[^<]*>$/.test(l) ? "<edit>" : l));
const expectedEditShape = (es: (EditedElement & EditContext)[]) => [
  "<canvas-edits>",
  ...es.flatMap((e) => ["<edit>", ...(e.block ? ["<element>", "</element>"] : []), "</edit>"]),
  "</canvas-edits>",
];

describe("<canvas-edits>", () => {
  it("starts no line with \"<\" but the block's own, whatever the frame said about the styles", () => {
    fc.assert(
      fc.property(edits, (es) => {
        expect(shapeOfEdits(describeEdits(es))).toEqual(expectedEditShape(es));
      }),
      { numRuns: 300 },
    );
  });

  it("reads back into each element's component and changes, in order, and the rest of the message", () => {
    fc.assert(
      fc.property(edits, fc.option(fc.oneof(userText, edits.map(describeEdits)), { nil: null }), (es, r) => {
        expect(splitEdits(withRest(describeEdits(es), r))).toEqual({
          edits: es.map((e) => ({ component: e.componentName, changes: changesSaid(e) })),
          text: r ?? "",
        });
      }),
      { numRuns: 300 },
    );
  });
});

// "<" is written "&lt;", and the "&" of a literal "&lt;" (or "&amp;") is
// written "&amp;": so it comes back as written, and the agent can tell the
// two apart. Every case holds an "&lt;".
describe("the escape's own spelling", () => {
  const withLt = fc.tuple(name, name).map(([a, b]) => `${a}&lt;${b}`);

  // A frame named "a&lt;b" comes back as "a<b · ...".
  it("comes back as written in a frame's name", () => {
    fc.assert(
      fc.property(picks, withLt, (all, frame) => {
        const renamed = all.map((p) => ({ ...p, pick: { ...p.pick, frame } }));
        expect(splitTagged(describeTags(renamed)).tags).toEqual(chipsOf(renamed));
      }),
      { numRuns: 100 },
    );
  });

  // A comment "use &lt; here" comes back "use < here".
  it("comes back as written in a comment's text", () => {
    fc.assert(
      fc.property(freshWith(elementBlock), withLt, (f, text) => {
        const written = f.map((c) => ({ ...c, text }));
        expect(splitComments(describeComments(written, []))?.comments).toEqual(commentsOf(written));
      }),
      { numRuns: 100 },
    );
  });
});

// A frame is the user's dev server, running their code and whatever it
// loads; it answers with strings, and the canvas writes them in. Can a frame
// that misbehaves (or renders odd data) corrupt the message's structure?
describe("a misbehaving frame", () => {
  const hostileLine = fc.oneof(fc.constantFrom(...STRUCTURAL), line);
  // A line break and then anything, after what a frame would write.
  const broken = (arb: fc.Arbitrary<string>) => fc.tuple(arb, hostileLine).map(([a, l]) => `${a}\n${l}`);
  const anyString = fc.oneof(
    fc.string({ maxLength: 12, unit: "binary" }),
    fc.array(fc.oneof(fc.constantFrom(...STRUCTURAL, "\n", " "), fc.string({ maxLength: 3 })), { maxLength: 6 }).map((p) => p.join("")),
  );

  it("can't start a line with \"<\" through any element name", () => {
    fc.assert(
      fc.property(contextWith(anyString, fc.option(openingTag, { nil: null })), (c) => {
        expect(startsTag(describeContext(c))).toEqual(["<element>", "</element>"]);
      }),
      { numRuns: 300 },
    );
  });

  // `within` keeps its "<": a line break in it would put any line in the
  // block.
  it("can't start a line with \"<\" through `within`", () => {
    fc.assert(
      fc.property(contextWith(element, broken(openingTag)), (c) => {
        expect(startsTag(describeContext(c))).toEqual(["<element>", "</element>"]);
      }),
      { numRuns: 300 },
    );
  });

  // A line break in the element name ("element: a" on the next line) would
  // be a chip of its own. An id may hold one: the DOM takes any string
  // (`<div id={title}>`).
  it("can't add or change chips through a line break in the element name", () => {
    fc.assert(
      fc.property(picks, fc.nat(), info, contextWith(broken(element), fc.constant(null)), userText, (all, at, inf, c, text) => {
        const { all: withIt, i } = inserting(all, at, (frame) => ({ pick: { frame, info: inf }, context: c }));
        const read = splitTagged(`${describeTags(withIt)}\n\n${text}`);
        const order = chipsOf(withIt);
        const hostile = order.indexOf(`${withIt[i]!.pick.frame} · ${c.element}`);
        expect(read.tags).toHaveLength(order.length);
        expect(read.tags.filter((_, k) => k !== hostile)).toEqual(order.filter((_, k) => k !== hostile));
        expect(read.text).toBe(text);
      }),
      { numRuns: 300 },
    );
  });

  // An id with a space in it ("my id"): a chip read up to the first
  // whitespace would say "div#my". One that ends in a space and a quoted
  // string reads as a last-seen block's text: the one name a chip can't
  // tell apart.
  it("comes back as its whole element name in its chip, whitespace and all", () => {
    const spaced = fc
      .tuple(tag, ident, ident)
      .map(([t, a, b]) => `${t}#${a} ${b}`)
      .filter((n) => !/ "(?:[^"\\]|\\.)*"$/.test(n));
    fc.assert(
      fc.property(picks, fc.nat(), info, contextWith(spaced, fc.constant(null)), (all, at, inf, c) => {
        const { all: withIt } = inserting(all, at, (frame) => ({ pick: { frame, info: inf }, context: c }));
        expect(splitTagged(describeTags(withIt)).tags).toEqual(chipsOf(withIt));
      }),
      { numRuns: 100 },
    );
  });

  // A line break in `within` would end the block early
  // ("</canvas-selection>" then "\n\n") or add a chip ("element: a").
  it("can't end the block or add chips through `within`", () => {
    fc.assert(
      fc.property(picks, fc.nat(), info, contextWith(element, broken(openingTag)), userText, (all, at, inf, c, text) => {
        const { all: withIt } = inserting(all, at, (frame) => ({ pick: { frame, info: inf }, context: c }));
        expect(splitTagged(`${describeTags(withIt)}\n\n${text}`)).toEqual({ tags: chipsOf(withIt), text });
      }),
      { numRuns: 300 },
    );
  });

  // What the canvas last saw came from the frame too: a line break in its
  // id, location or callsite would add a chip.
  it("can't add chips through what the canvas last saw", () => {
    const hostileInfo = fc.oneof(
      infoWith(broken(ident), fc.option(loc, { nil: null })),
      infoWith(fc.constant(""), broken(loc)),
    );
    fc.assert(
      fc.property(picks, fc.nat(), hostileInfo, userText, (all, at, inf, text) => {
        const { all: withIt, i } = inserting(all, at, (frame) => ({ pick: { frame, info: inf }, context: null }));
        const read = splitTagged(`${describeTags(withIt)}\n\n${text}`);
        const order = chipsOf(withIt);
        const hostile = order.indexOf(`${withIt[i]!.pick.frame} · ${nameOf(withIt[i]!)}`);
        expect(read.tags).toHaveLength(order.length);
        expect(read.tags.filter((_, k) => k !== hostile)).toEqual(order.filter((_, k) => k !== hostile));
        expect(read.text).toBe(text);
      }),
      { numRuns: 300 },
    );
  });

  it("can't change a comment through its element name or what the canvas last saw", () => {
    const hostileBlock = fc.oneof(
      contextWith(anyString, fc.option(openingTag, { nil: null })).map(describeContext),
      fc
        .tuple(name, infoWith(broken(ident), broken(loc)))
        .map(([frame, inf]) => describeLastSeen({ frame, info: inf })),
    );
    fc.assert(
      fc.property(freshWith(hostileBlock), earlier, rest, (f, e, r) => {
        expect(splitComments(withRest(describeComments(f, e), r))).toEqual({ comments: commentsOf(f), text: r ?? "" });
      }),
      { numRuns: 300 },
    );
  });

  // A line break in `within` under a pin would open a comment
  // ('<comment id="1" component="Evil">') or end the block.
  it("can't add, change or end comments through `within`", () => {
    const hostileBlock = contextWith(element, broken(openingTag)).map(describeContext);
    fc.assert(
      fc.property(freshWith(hostileBlock), earlier, rest, (f, e, r) => {
        expect(splitComments(withRest(describeComments(f, e), r))).toEqual({ comments: commentsOf(f), text: r ?? "" });
      }),
      { numRuns: 300 },
    );
  });
});

it("generates the cases that matter", () => {
  // The generators reach the lines that fool a line-based reader, in the
  // markup and in the texts, and the shapes of real messages, or the
  // properties above say little.
  const seen = <T>(arb: fc.Arbitrary<T>, pred: (v: T) => boolean) =>
    fc.sample(arb, { numRuns: 500, seed: 1 }).filter(pred).length;
  const htmlLines = (c: ElementContext) => c.html.split("\n");

  expect(seen(context, (c) => htmlLines(c).includes("</canvas-selection>"))).toBeGreaterThan(25);
  expect(seen(context, (c) => htmlLines(c).includes("<element>") || htmlLines(c).includes("</element>"))).toBeGreaterThan(25);
  expect(seen(context, (c) => htmlLines(c).some((l) => /^ +\S/.test(l)))).toBeGreaterThan(25);
  expect(seen(context, (c) => c.html.includes("\r\n"))).toBeGreaterThan(25);
  expect(seen(context, (c) => c.html.endsWith("\n"))).toBeGreaterThan(25);
  expect(seen(context, (c) => htmlLines(c).length >= 4)).toBeGreaterThan(25);
  expect(seen(context, (c) => !!c.within && c.within.includes("&quot;"))).toBeGreaterThan(5);
  expect(seen(context, (c) => c.repeat.length > 1)).toBeGreaterThan(25);
  expect(seen(context, (c) => c.path.some((p) => /[\r\n]/.test(p.loc)))).toBeGreaterThan(25);
  expect(seen(context, (c) => /[\r\n]/.test(c.text))).toBeGreaterThan(25);
  expect(seen(context, (c) => !!c.sibling)).toBeGreaterThan(25);
  expect(seen(context, (c) => c.element.includes("<"))).toBeGreaterThan(25);

  expect(seen(picks, (p) => p.some((x) => !x.context) && p.some((x) => x.context))).toBeGreaterThan(25);
  // Interleaved: a frame picked again after another, so grouping reorders.
  expect(seen(picks, (p) => chipsOf(p).join() !== p.map((x) => `${x.pick.frame} · ${nameOf(x)}`).join())).toBeGreaterThan(25);
  expect(seen(picks, (p) => new Set(p.map((x) => x.pick.frame)).size >= 3)).toBeGreaterThan(25);
  expect(seen(picks, (p) => groupsOf(p).length > new Set(p.map((x) => x.pick.frame)).size)).toBeGreaterThan(25);
  expect(seen(picks, (p) => p.some((x) => /[<"\\]/.test(x.pick.frame)))).toBeGreaterThan(25);
  expect(seen(picks, (p) => p.some((x) => x.pick.frame.includes("\n")))).toBeGreaterThan(5);

  expect(seen(userText, (t) => t === "")).toBeGreaterThan(25);
  expect(seen(userText, (t) => t.startsWith("<canvas-selection>"))).toBeGreaterThan(25);
  expect(seen(userText, (t) => /^<canvas-selection>\n[\s\S]*\n<\/canvas-selection>/.test(t))).toBeGreaterThan(25);
  expect(seen(userText, (t) => t.split("\n").length >= 3)).toBeGreaterThan(25);

  const lines = (t: string) => t.split("\n");
  expect(seen(commentText, (t) => lines(t).includes("<element>"))).toBeGreaterThan(25);
  expect(seen(commentText, (t) => lines(t).includes("</comment>"))).toBeGreaterThan(25);
  expect(seen(commentText, (t) => lines(t).some((l) => l.startsWith("<")) && lines(t).length > 1)).toBeGreaterThan(25);
  expect(seen(fresh, (f) => f.some((c) => c.element) && f.some((c) => !c.element))).toBeGreaterThan(25);
  expect(seen(fresh, (f) => f.some((c) => c.element?.includes("as last seen")))).toBeGreaterThan(25);
  expect(seen(fresh, (f) => f.length >= 3)).toBeGreaterThan(25);
  expect(seen(earlier, (e) => e.some((s) => s.comments.length >= 2))).toBeGreaterThan(25);
  expect(seen(rest, (r) => r === null)).toBeGreaterThan(25);
  expect(seen(rest, (r) => !!r?.startsWith("<canvas-comments>"))).toBeGreaterThan(25);

  // Edits: what a frame says about the styles reaches the changes with
  // lines that are a block's own, and with an element block and without.
  const changeLines = (es: (EditedElement & EditContext)[]) => es.flatMap((e) => changesOf(e.base, e.now).map((c) => `${c.from}${c.to}`));
  expect(seen(edits, (es) => changeLines(es).some((t) => /[\r\n]/.test(t)))).toBeGreaterThan(25);
  expect(seen(edits, (es) => changeLines(es).some((t) => t.includes("<")))).toBeGreaterThan(25);
  expect(seen(edits, (es) => es.some((e) => e.now.shadowRest.some((l) => /[\r\n]/.test(l))))).toBeGreaterThan(5);
  expect(seen(edits, (es) => es.some((e) => e.block) && es.some((e) => !e.block))).toBeGreaterThan(25);
  expect(seen(edits, (es) => es.length >= 3)).toBeGreaterThan(25);
});
