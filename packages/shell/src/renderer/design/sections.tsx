/**
 * The Design section of the right panel, as the confirmed sidebar draws it
 * (the Antidraw workspace's Sidebar02Classic): one column of sections in
 * Figma UI3's order (Auto layout, Appearance, Typography, Fill, Stroke,
 * Effects), split by hairlines, each with a quiet title, a dot once it
 * holds an edit, and its actions at the right. Auto layout is the compact
 * UI3 block: direction, W/H, then the alignment pad with gap and padding
 * stacked beside it. Empty lists fold to a single "Name  +" line. With
 * nothing selected, how to pick something.
 */
import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  FoldVertical,
  Grid2x2,
  Minus,
  MousePointer2,
  Plus,
  Scan,
  SquareDashedMousePointer,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  TextWrap,
} from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { FULL, WEIGHTS, changedGroups, type Align, type Flow, type Shadow, type Sizing, type Stroke, type Style as S, type TextAlign } from "@/shared/design";
import { SURFACE } from "./dial";
import {
  AlignPad,
  ColorRow,
  Corner,
  DropShadowIcon,
  IconBtn,
  Menu,
  MenuItem,
  Num,
  Row,
  Seg,
  Select,
  SizeField,
  T,
  TextField,
  TextFieldish,
  parseNum,
} from "./kit";

// The hairline between sections.
const LINE = "#333333";

type Put = (patch: Partial<S>) => void;

export type EditProps = {
  s: S;
  set: Put;
  edited: (key: string) => boolean;
  // The element's size as its frame drew it: what a hugging or filling side reads.
  size: { w: number; h: number };
};

/* ── Section chrome ───────────────────────────────────────────────────── */

// A section: hairline above, a quiet 11.5px title, its actions at the right.
// `empty` folds it to the title line alone (dimmer), as Figma does for lists.
const Section = ({ title, dirty, actions, empty, children }: { title: string; dirty: boolean; actions?: ReactNode; empty?: boolean; children?: ReactNode }) => (
  <section className="border-t px-4" style={{ borderColor: LINE }}>
    <div className="flex h-10 items-center gap-1.5">
      <span className="text-[11.5px] font-medium" style={{ color: empty ? T.text2 : T.text }}>
        {title}
      </span>
      {dirty && <span className="size-[5px] rounded-full" style={{ background: T.edited }} title="Edited" />}
      <span className="flex-1" />
      <div className="-mr-1.5 flex items-center">{actions}</div>
    </div>
    {!empty && <div className="flex flex-col gap-2 pb-4">{children}</div>}
  </section>
);

/* ── Auto layout ──────────────────────────────────────────────────────── */

// Four sides as two fields, ↔ and ↕ (Mixed when the two differ), or one each.
const Sides = ({ name, keys, s, set }: { name: string; keys: ["pt" | "mt", "pr" | "mr", "pb" | "mb", "pl" | "ml"]; s: S; set: Put }) => {
  const [four, setFour] = useState(false);
  const [t, r, b, l] = keys;
  const put = (p: Partial<Record<(typeof keys)[number], number>>) =>
    set(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.max(0, v)])) as Partial<S>);
  return (
    <div className="flex min-w-0 flex-1 items-start gap-1">
      <div className="grid flex-1 grid-cols-2 gap-1.5">
        {four ? (
          <>
            <Num label="T" value={s[t]} onChange={(v) => put({ [t]: v })} />
            <Num label="R" value={s[r]} onChange={(v) => put({ [r]: v })} />
            <Num label="B" value={s[b]} onChange={(v) => put({ [b]: v })} />
            <Num label="L" value={s[l]} onChange={(v) => put({ [l]: v })} />
          </>
        ) : (
          <>
            <Num label="↔" value={s[l] === s[r] ? s[l] : null} base={s[l]} onChange={(v) => put({ [l]: v, [r]: v })} />
            <Num label="↕" value={s[t] === s[b] ? s[t] : null} base={s[t]} onChange={(v) => put({ [t]: v, [b]: v })} />
          </>
        )}
      </div>
      <IconBtn tip={`Individual ${name}`} on={four} onClick={() => setFour(!four)}>
        <Scan />
      </IconBtn>
    </div>
  );
};

// Gap, or Auto: the children pushed apart (space between). A grid only spaces:
// its gap stays a number whatever its code justifies with.
const Gap = ({ s, set }: { s: S; set: Put }) => (
  <div className="flex items-center gap-1">
    {s.between && s.flow !== "grid" ? (
      <TextFieldish label="↔" className="flex-1">
        Auto
      </TextFieldish>
    ) : (
      <Num
        label={s.flow === "column" ? "↕" : "↔"}
        value={s.gap}
        min={0}
        onChange={(gap) => set(s.flow === "grid" ? { gap } : { gap, between: false })}
        className="flex-1"
      />
    )}
    {s.flow !== "grid" && (
      <Menu
        width={160}
        trigger={(toggle) => (
          <IconBtn tip="Gap mode" onClick={toggle}>
            <ChevronDown className="!size-3.5" />
          </IconBtn>
        )}
      >
        {(close) => (
          <>
            <MenuItem on={!s.between} onClick={() => (set({ between: false }), close())}>
              {s.gap}px
            </MenuItem>
            <MenuItem on={s.between} onClick={() => (set({ between: true }), close())}>
              Auto (space between)
            </MenuItem>
          </>
        )}
      </Menu>
    )}
  </div>
);

const LayoutSection = ({ s, set, edited, size }: EditProps) => {
  // A grid's tracks are its code's: the panel only spaces it.
  const flex = s.flow !== "none" && s.flow !== "grid";
  const dir = s.flow === "column" ? "column" : "row";
  // The pad is across and down; the style, along its direction and across it.
  const [jx, jy] = dir === "row" ? [s.main, s.cross] : [s.cross, s.main];
  const pick = (x: Align, y: Align, dbl: boolean) => {
    const [main, cross] = dir === "row" ? [x, y] : [y, x];
    set(dbl ? { main, cross, between: true } : s.between ? { cross } : { main, cross });
  };
  const sizeField = (axis: "w" | "h") => {
    const mode = axis === "w" ? s.wMode : s.hMode;
    const measured = Math.round(size[axis]);
    const at = mode === "fixed" ? s[axis] : measured;
    return (
      <SizeField
        axis={axis === "w" ? "W" : "H"}
        value={s[axis]}
        mode={mode}
        measured={measured}
       
        onValue={(v) => set(axis === "w" ? { wMode: "fixed", w: v } : { hMode: "fixed", h: v })}
        onMode={(m: Sizing) => set(axis === "w" ? { wMode: m, w: m === "fixed" ? at : s.w } : { hMode: m, h: m === "fixed" ? at : s.h })}
      />
    );
  };
  const padding = <Sides name="padding" keys={["pt", "pr", "pb", "pl"]} s={s} set={set} />;
  return (
    <Section title={s.flow !== "none" ? "Auto layout" : "Layout"} dirty={["flow", "align", "gap", "w", "h", "pad", "margin"].some(edited)}>
      <Seg<Flow>
        value={s.flow}
        onChange={(flow) => set({ flow })}
        options={[
          { v: "none", label: <Scan className="size-3.5" />, tip: "Freeform (no auto layout)" },
          { v: "column", label: <ArrowDown className="size-3.5" />, tip: "Vertical" },
          { v: "row", label: <ArrowRight className="size-3.5" />, tip: "Horizontal" },
          { v: "wrap", label: <TextWrap className="size-3.5" />, tip: "Wrap" },
          // Only for one that is a grid: the panel doesn't make one.
          ...(s.flow === "grid" ? [{ v: "grid" as const, label: <Grid2x2 className="size-3.5" />, tip: "Grid" }] : []),
        ]}
      />
      <div className="flex gap-1.5">
        {sizeField("w")}
        {sizeField("h")}
      </div>
      {flex ? (
        // UI3's block: the pad on the left, gap over padding to its right.
        <div className="flex items-start gap-2">
          <AlignPad size={64} dir={dir} jx={jx} jy={jy} between={s.between} onPick={pick} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Gap s={s} set={set} />
            {padding}
          </div>
        </div>
      ) : (
        <>
          {s.flow === "grid" && <Gap s={s} set={set} />}
          {padding}
        </>
      )}
      <Row label="Margin">
        <Sides name="margin" keys={["mt", "mr", "mb", "ml"]} s={s} set={set} />
      </Row>
    </Section>
  );
};

/* ── Appearance ───────────────────────────────────────────────────────── */

const AppearanceSection = ({ s, set, edited }: EditProps) => {
  // Its corners differ: an edit rounds the ones that are rounded.
  const someCorners = s.corners.some((c) => c !== s.radius) && s.corners.some((c) => c > 0);
  return (
    <Section
      title="Appearance"
      dirty={["opacity", "radius", "hidden"].some(edited)}
      actions={
        <IconBtn tip={s.hidden ? "Show" : "Hide"} onClick={() => set({ hidden: !s.hidden })}>
          {s.hidden ? <EyeOff /> : <Eye />}
        </IconBtn>
      }
    >
      {/* Opacity and radius share a row. */}
      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 flex-1">
          <Num label={<span className="text-[13px]">◐</span>} value={s.opacity} onChange={(opacity) => set({ opacity })} min={0} max={100} unit="%" />
        </div>
        <div className="min-w-0 flex-1" title={someCorners ? "Corner radius: rounds the corners that are rounded" : "Corner radius"}>
          <Num
            label={<Corner />}
            value={s.radius}
            min={0}
            max={FULL}
            format={(v) => (v >= FULL ? "Full" : String(v))}
            onChange={(radius) => set({ radius })}
          />
        </div>
      </div>
    </Section>
  );
};

/* ── Typography ───────────────────────────────────────────────────────── */

// Line height: Auto, px, or % of the size (in px once typed).
const LineHeight = ({ s, set }: { s: S; set: Put }) => {
  const [text, setText] = useState<string | null>(null);
  const shown = s.lh ? String(s.lh) : "Auto";
  const commit = () => {
    if (text === null) return;
    const t = text.trim().toLowerCase();
    if (t === "auto" || t === "") set({ lh: 0 });
    else if (t.endsWith("%")) {
      const v = parseFloat(t);
      if (Number.isFinite(v)) set({ lh: Math.max(0, Math.round((s.size * v) / 100)) });
    } else {
      const v = parseNum(t, s.lh || Math.round(s.size * 1.2));
      if (v !== null) set({ lh: Math.max(0, v) });
    }
    setText(null);
  };
  return (
    <div className="group/num relative flex h-7 min-w-0 flex-1 items-center rounded-[6px] pr-2 text-[12px]" style={{ background: T.field }} title="Line height · Auto, px or %">
      <span className="grid h-full w-7 shrink-0 place-items-center" style={{ color: T.text3 }}>
        <FoldVertical className="size-3.5" />
      </span>
      <input
        aria-label="Line height"
        value={text ?? shown}
        onFocus={(e) => (setText(shown), e.target.select())}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setText(null);
            const from = s.lh || Math.round(s.size * 1.2);
            set({ lh: Math.max(0, from + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)) });
          }
        }}
        className="dk-mono h-full min-w-0 flex-1 bg-transparent tabular-nums outline-none"
        style={{ color: s.lh ? T.text : T.text2 }}
      />
      <span className="pointer-events-none absolute inset-0 rounded-[6px] ring-1 ring-inset ring-transparent group-focus-within/num:ring-[#E8E8E8]" />
    </div>
  );
};

const TypographySection = ({ s, set, edited }: EditProps) => (
  <Section title="Typography" dirty={["content", "weight", "size", "lh", "ls", "talign", "color"].some(edited)}>
    {s.content !== null && <TextField label="Text" value={s.content} onChange={(content) => set({ content })} />}
    <div className="flex gap-1.5">
      <Select
        className="flex-1"
        value={s.weight}
        options={WEIGHTS.map(([w]) => w)}
        onChange={(weight) => set({ weight })}
        render={(w) => <span style={{ fontWeight: Number(w) }}>{WEIGHTS.find(([x]) => x === w)?.[1] ?? w}</span>}
      />
      <Num value={s.size} onChange={(size) => set({ size })} min={1} className="w-[76px]" />
    </div>
    <div className="flex gap-1.5">
      <LineHeight s={s} set={set} />
      <Num label={<span className="text-[10px] tracking-[0.1em]">|A|</span>} value={s.ls} step={0.1} onChange={(ls) => set({ ls })} className="flex-1" />
    </div>
    <Seg<TextAlign>
      value={s.talign}
      onChange={(talign) => set({ talign })}
      options={[
        { v: "left", label: <TextAlignStart className="size-3.5" />, tip: "Align left" },
        { v: "center", label: <TextAlignCenter className="size-3.5" />, tip: "Align centre" },
        { v: "right", label: <TextAlignEnd className="size-3.5" />, tip: "Align right" },
        { v: "justify", label: <TextAlignJustify className="size-3.5" />, tip: "Justify" },
      ]}
    />
    <ColorRow hex={s.color} alpha={s.colorA} onChange={(color, colorA) => set({ color, colorA })} />
  </Section>
);

/* ── Fill, stroke, effects ────────────────────────────────────────────── */

const Add = ({ what, onClick }: { what: string; onClick: () => void }) => (
  <IconBtn tip={`Add ${what}`} onClick={onClick}>
    <Plus />
  </IconBtn>
);
const Remove = ({ what, onClick }: { what: string; onClick: () => void }) => (
  <IconBtn tip={`Remove ${what}`} onClick={onClick}>
    <Minus />
  </IconBtn>
);

// A gradient (or an image) shows as one, and stays the code's to change.
const FillSection = ({ s, set, edited }: EditProps) => (
  <Section
    title="Fill"
    dirty={edited("fill")}
    empty={!s.fill && !s.gradient}
    actions={!s.fill && !s.gradient && <Add what="fill" onClick={() => set({ fill: "#FFFFFF", fillA: 100 })} />}
  >
    {s.gradient ? (
      <TextFieldish dim title="A gradient or an image: its code's to change">
        Gradient
      </TextFieldish>
    ) : (
      s.fill && <ColorRow hex={s.fill} alpha={s.fillA} onChange={(fill, fillA) => set({ fill, fillA })} right={<Remove what="fill" onClick={() => set({ fill: null })} />} />
    )}
  </Section>
);

const StrokeSection = ({ s, set, edited }: EditProps) => {
  const k = s.stroke;
  const patch = (p: Partial<Stroke>) => k && set({ stroke: { ...k, ...p } });
  return (
    <Section title="Stroke" dirty={edited("stroke")} empty={!k} actions={!k && <Add what="stroke" onClick={() => set({ stroke: { color: "#000000", a: 100, w: 1 } })} />}>
      {k && (
        <>
          <ColorRow hex={k.color} alpha={k.a} onChange={(color, a) => patch({ color, a })} right={<Remove what="stroke" onClick={() => set({ stroke: null })} />} />
          <div className="flex gap-1.5" title="Stroke weight">
            <Num label="≡" value={k.w} min={0} onChange={(w) => patch({ w })} className="w-[64px]" />
          </div>
        </>
      )}
    </Section>
  );
};

// The shadow that shows first; the others under it stay as they are. Its
// values open from its icon.
const EffectsSection = ({ s, set, edited }: EditProps) => {
  const [open, setOpen] = useState(false);
  const sh = s.shadow;
  const patch = (p: Partial<Shadow>) => sh && set({ shadow: { ...sh, ...p } });
  return (
    <Section
      title="Effects"
      dirty={edited("shadow")}
      empty={!sh}
      actions={!sh && <Add what="effect" onClick={() => set({ shadow: { x: 0, y: 4, blur: 12, spread: 0, color: "#000000", a: 25 } })} />}
    >
      {sh && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1">
            <IconBtn tip="Edit effect" on={open} onClick={() => setOpen(!open)}>
              <DropShadowIcon />
            </IconBtn>
            <div className="flex h-7 min-w-0 flex-1 items-center rounded-[6px] px-2 text-[12px]" style={{ background: T.field, color: T.text }}>
              <span className="flex-1 truncate">Drop shadow</span>
            </div>
            <Remove what="effect" onClick={() => set({ shadow: null })} />
          </div>
          {open && (
            <div className="ml-8 flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                <Num label="X" value={sh.x} onChange={(x) => patch({ x })} />
                <Num label="Y" value={sh.y} onChange={(y) => patch({ y })} />
                <Num label="Blur" value={sh.blur} min={0} onChange={(blur) => patch({ blur })} />
                <Num label="Spread" value={sh.spread} onChange={(spread) => patch({ spread })} />
              </div>
              <ColorRow hex={sh.color} alpha={sh.a} onChange={(color, a) => patch({ color, a })} />
            </div>
          )}
        </div>
      )}
    </Section>
  );
};

/* ── The section ──────────────────────────────────────────────────────── */

export const Empty = ({ icon: Icon, title, body, children }: { icon: typeof MousePointer2; title: string; body: string; children?: ReactNode }) => (
  <div className="flex flex-col gap-4 px-3 pt-5">
    <div className="flex flex-col items-start gap-3 px-1">
      <span className={cn("grid size-9 place-items-center text-white/60", SURFACE)}>
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-white/85">{title}</span>
        <p className="m-0 text-[12.5px] leading-[18px] text-white/45">{body}</p>
      </div>
    </div>
    {children}
  </div>
);

// The selected element's styles (`s`), against what it had before any edit
// (`base`); with none selected (`selected`, its key), how to pick one.
// `text`: text is written right in it, so Typography shows.
export const DesignSection = ({
  selected,
  s,
  base,
  text,
  set,
  size,
}: {
  selected: string | null;
  s: S | null;
  base: S | null;
  text: boolean;
  set: Put;
  size: { w: number; h: number };
}) => {
  if (!selected)
    return (
      <Empty
        icon={SquareDashedMousePointer}
        title="Select an element"
        body="Pick the Inspect tool (I), then click inside a frame to edit its layout, type, fill and effects. Edits show in the frame at once; Apply hands them to the agent."
      />
    );
  // Its styles are on their way from its frame.
  if (!s || !base) return null;
  const changed = new Set(changedGroups(base, s).map((g) => g.key));
  const props: EditProps = { s, set, edited: (k) => changed.has(k), size };
  return (
    // The panel's tab header already draws a line, so the first section skips its own.
    <div key={selected} className="flex flex-col pb-6 text-[12px] [&>section:first-of-type]:border-t-0">
      <LayoutSection {...props} />
      <AppearanceSection {...props} />
      {text && <TypographySection {...props} />}
      <FillSection {...props} />
      <StrokeSection {...props} />
      <EffectsSection {...props} />
      <div className="border-t" style={{ borderColor: LINE }} />
    </div>
  );
};

