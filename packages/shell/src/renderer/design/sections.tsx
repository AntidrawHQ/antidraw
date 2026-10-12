/**
 * The Design section of the right panel: the selected element's styles in
 * folders (Layout, Appearance, Text, Fill, Stroke, Effects), each control
 * tinted once it's edited; with nothing selected, how to pick something.
 */
import { useState, type ReactNode } from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  LayoutGrid,
  Minus,
  MousePointer2,
  Plus,
  Scan,
  SquareDashed,
  SquareDashedMousePointer,
  WrapText,
} from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { FULL, WEIGHTS, changedGroups, r1, type Flow, type Shadow, type Sizing, type Stroke, type Style as S, type TextAlign } from "@/shared/design";
import { AlignPad, ColorRow, Folder, IconButton, LabeledRow, ROW, SURFACE, Segmented, Select, Slider, TextRow, Toggle } from "./dial";

export const icon = "size-3.5";

// Spacing and sizes step along Tailwind's 4px scale, so the code gets
// `gap-3`, not `gap-[13px]`. Typed values snap to it too.
const SPACE = 4;

// `bounds`: the frame's size, how far a width or height can go.
export type EditProps = {
  s: S;
  set: (patch: Partial<S>) => void;
  edited: (key: string) => boolean;
  size: { w: number; h: number };
  bounds: { w: number; h: number };
};

// Four sides as two sliders, X and Y, or (`apart`) one each.
const Sides = ({
  name,
  keys,
  s,
  set,
  edited,
  apart,
}: {
  name: string;
  keys: ["pt" | "mt", "pr" | "mr", "pb" | "mb", "pl" | "ml"];
  s: S;
  set: (patch: Partial<S>) => void;
  edited: boolean;
  apart: boolean;
}) => {
  const [t, r, b, l] = keys;
  return apart ? (
    <div className="grid grid-cols-2 gap-1.5">
      {keys.map((k, i) => (
        <Slider
          key={k}
          label={`${name} ${["top", "right", "bottom", "left"][i]}`}
          value={s[k]}
          min={0}
          max={64}
          step={SPACE}
          edited={edited}
          onChange={(v) => set({ [k]: v } as Partial<S>)}
        />
      ))}
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-1.5">
      <Slider
        label={`${name} X`}
        value={s[l]}
        format={(v) => (s[l] === s[r] ? String(v) : "Mixed")}
        min={0}
        max={64}
        step={SPACE}
        edited={edited}
        onChange={(v) => set({ [l]: v, [r]: v } as Partial<S>)}
      />
      <Slider
        label={`${name} Y`}
        value={s[t]}
        format={(v) => (s[t] === s[b] ? String(v) : "Mixed")}
        min={0}
        max={64}
        step={SPACE}
        edited={edited}
        onChange={(v) => set({ [t]: v, [b]: v } as Partial<S>)}
      />
    </div>
  );
};

export const LayoutFolder = ({ s, set, edited, size, bounds }: EditProps) => {
  const [apart, setApart] = useState(false);
  // A grid's tracks are its code's: the panel only spaces it.
  const flex = s.flow !== "none" && s.flow !== "grid";
  const direction = s.flow === "column" ? "column" : "row";
  const sizeRow = (axis: "w" | "h") => {
    const mode = axis === "w" ? s.wMode : s.hMode;
    const at = mode === "fixed" ? s[axis] : Math.round(size[axis]);
    return (
      <div className="flex gap-1.5">
        <Slider
          label={axis === "w" ? "Width" : "Height"}
          value={at}
          min={0}
          max={Math.max(bounds[axis], at)}
          step={SPACE}
          dim={mode !== "fixed"}
          edited={edited(axis)}
          onChange={(v) => set(axis === "w" ? { wMode: "fixed", w: v } : { hMode: "fixed", h: v })}
          className="min-w-0 flex-1"
        />
        <Select<Sizing>
          value={mode}
          edited={edited(axis)}
          onChange={(m) => set(axis === "w" ? { wMode: m, w: m === "fixed" ? at : s.w } : { hMode: m, h: m === "fixed" ? at : s.h })}
          options={[
            { value: "hug", label: "Hug" },
            { value: "fill", label: "Fill" },
            { value: "fixed", label: "Fixed" },
          ]}
          className="w-[78px] shrink-0"
        />
      </div>
    );
  };
  const gap = (
    <Slider
      label="Gap"
      value={s.gap}
      min={0}
      max={64}
      step={SPACE}
      format={(v) => (s.between ? "Auto" : String(v))}
      edited={edited("gap")}
      onChange={(gap) => set({ gap, between: false })}
    />
  );
  return (
    <Folder title="Layout" dot={["flow", "align", "gap", "w", "h", "pad", "margin"].some(edited)}>
      <LabeledRow label="Auto layout">
        <Segmented<Flow>
          value={s.flow}
          onChange={(flow) => set({ flow })}
          options={[
            { value: "none", title: "None", label: <SquareDashed className={icon} /> },
            { value: "column", title: "Vertical", label: <ArrowDown className={icon} /> },
            { value: "row", title: "Horizontal", label: <ArrowRight className={icon} /> },
            { value: "wrap", title: "Wrap", label: <WrapText className={icon} /> },
            // Only for one that is a grid: the panel doesn't make one.
            ...(s.flow === "grid" ? [{ value: "grid" as const, title: "Grid", label: <LayoutGrid className={icon} /> }] : []),
          ]}
        />
      </LabeledRow>
      {flex && (
        <div className="flex gap-1.5">
          <AlignPad
            direction={direction}
            main={s.main}
            cross={s.cross}
            between={s.between}
            edited={edited("align")}
            onChange={(main, cross) => set(s.between ? { cross } : { main, cross })}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {gap}
            <Segmented<"packed" | "between">
              full
              value={s.between ? "between" : "packed"}
              onChange={(v) => set({ between: v === "between" })}
              options={[
                { value: "packed", label: "Packed", title: "Packed: gap between items" },
                { value: "between", label: "Between", title: "Space between" },
              ]}
            />
          </div>
        </div>
      )}
      {s.flow === "grid" && gap}
      {sizeRow("w")}
      {sizeRow("h")}
      <div className="flex gap-1.5">
        <div className="min-w-0 flex-1">
          <Sides name="Pad" keys={["pt", "pr", "pb", "pl"]} s={s} set={set} edited={edited("pad")} apart={apart} />
        </div>
        <button
          type="button"
          title="Padding and margin per side"
          aria-pressed={apart}
          onClick={() => setApart(!apart)}
          className={cn(
            "grid w-9 shrink-0 cursor-pointer place-items-center self-start hover:bg-white/10",
            ROW,
            SURFACE,
            apart ? "bg-white/[0.11] text-white/95" : "text-white/50",
          )}
        >
          <Scan className={icon} />
        </button>
      </div>
      <div className="pr-[42px]">
        <Sides name="Margin" keys={["mt", "mr", "mb", "ml"]} s={s} set={set} edited={edited("margin")} apart={apart} />
      </div>
    </Folder>
  );
};

export const AppearanceFolder = ({ s, set, edited }: EditProps) => (
  <Folder title="Appearance" dot={["opacity", "radius", "hidden"].some(edited)}>
    <Toggle label="Visible" checked={!s.hidden} edited={edited("hidden")} onChange={(visible) => set({ hidden: !visible })} />
    <Slider label="Opacity" value={s.opacity} min={0} max={100} unit="%" edited={edited("opacity")} onChange={(opacity) => set({ opacity })} />
    <Slider
      label={s.corners.some((c) => c !== s.radius) && s.corners.some((c) => c > 0) ? "Radius (rounded corners)" : "Radius"}
      value={s.radius}
      min={0}
      max={FULL}
      step={2}
      format={(v) => (v >= FULL ? "Full" : String(v))}
      edited={edited("radius")}
      onChange={(radius) => set({ radius })}
    />
  </Folder>
);

export const TextFolder = ({ s, set, edited }: EditProps) => (
  <Folder title="Text" dot={["content", "weight", "size", "lh", "ls", "talign", "color"].some(edited)}>
    {s.content !== null && <TextRow label="Text" value={s.content} edited={edited("content")} onChange={(content) => set({ content })} />}
    <Select
      label="Weight"
      value={s.weight}
      edited={edited("weight")}
      onChange={(weight) => set({ weight })}
      options={WEIGHTS.map(([value, label]) => ({ value, label }))}
    />
    <Slider label="Size" value={s.size} min={8} max={72} edited={edited("size")} onChange={(size) => set({ size })} />
    <div className="grid grid-cols-2 gap-1.5">
      <Slider
        label="Line"
        value={s.lh}
        min={0}
        max={80}
        step={SPACE}
        format={(v) => (v ? String(v) : "Auto")}
        edited={edited("lh")}
        onChange={(lh) => set({ lh })}
      />
      <Slider label="Track" value={s.ls} min={-2} max={4} step={0.1} edited={edited("ls")} onChange={(ls) => set({ ls })} />
    </div>
    <LabeledRow label="Align">
      <Segmented<TextAlign>
        value={s.talign}
        onChange={(talign) => set({ talign })}
        options={[
          { value: "left", title: "Left", label: <AlignLeft className={icon} /> },
          { value: "center", title: "Center", label: <AlignCenter className={icon} /> },
          { value: "right", title: "Right", label: <AlignRight className={icon} /> },
          { value: "justify", title: "Justify", label: <AlignJustify className={icon} /> },
        ]}
      />
    </LabeledRow>
    <ColorRow label="Color" hex={s.color} alpha={s.colorA} edited={edited("color")} onChange={(color, colorA) => set({ color, colorA })} />
  </Folder>
);

export const AddRemove = ({ has, what, onAdd, onRemove }: { has: boolean; what: string; onAdd: () => void; onRemove: () => void }) => (
  <IconButton title={has ? `Remove ${what}` : `Add ${what}`} onClick={has ? onRemove : onAdd}>
    {has ? <Minus className="size-3.5" /> : <Plus className="size-3.5" />}
  </IconButton>
);

// A gradient (or an image) shows as one, and stays the code's to change.
export const FillFolder = ({ s, set, edited }: EditProps) => (
  <Folder
    title="Fill"
    dot={edited("fill")}
    actions={
      !s.gradient && <AddRemove has={!!s.fill} what="fill" onAdd={() => set({ fill: "#FFFFFF", fillA: 100 })} onRemove={() => set({ fill: null })} />
    }
  >
    {s.gradient ? (
      <LabeledRow label="Fill" className="pr-3">
        <span className="text-[13px] font-medium text-white/40">Gradient</span>
      </LabeledRow>
    ) : (
      s.fill && <ColorRow label="Fill" hex={s.fill} alpha={s.fillA} edited={edited("fill")} onChange={(fill, fillA) => set({ fill, fillA })} />
    )}
  </Folder>
);

export const BorderFolder = ({ s, set, edited }: EditProps) => {
  const k = s.stroke;
  const patch = (p: Partial<Stroke>) => k && set({ stroke: { ...k, ...p } });
  return (
    <Folder
      title="Border"
      dot={edited("stroke")}
      actions={
        <AddRemove has={!!k} what="border" onAdd={() => set({ stroke: { color: "#000000", a: 100, w: 1 } })} onRemove={() => set({ stroke: null })} />
      }
    >
      {k && <ColorRow label="Color" hex={k.color} alpha={k.a} edited={edited("stroke")} onChange={(color, a) => patch({ color, a })} />}
      {k && <Slider label="Width" value={k.w} min={0} max={8} step={1} format={r1} edited={edited("stroke")} onChange={(w) => patch({ w })} />}
    </Folder>
  );
};

// The shadow that shows first; the others under it stay as they are.
export const ShadowFolder = ({ s, set, edited }: EditProps) => {
  const sh = s.shadow;
  const patch = (p: Partial<Shadow>) => sh && set({ shadow: { ...sh, ...p } });
  return (
    <Folder
      title="Shadow"
      dot={edited("shadow")}
      actions={
        <AddRemove
          has={!!sh}
          what="shadow"
          onAdd={() => set({ shadow: { x: 0, y: 4, blur: 12, spread: 0, color: "#000000", a: 25 } })}
          onRemove={() => set({ shadow: null })}
        />
      }
    >
      {sh && (
        <div className="grid grid-cols-2 gap-1.5">
          <Slider label="X" value={sh.x} min={-32} max={32} edited={edited("shadow")} onChange={(x) => patch({ x })} />
          <Slider label="Y" value={sh.y} min={-32} max={32} edited={edited("shadow")} onChange={(y) => patch({ y })} />
          <Slider label="Blur" value={sh.blur} min={0} max={64} edited={edited("shadow")} onChange={(blur) => patch({ blur })} />
          <Slider label="Spread" value={sh.spread} min={-24} max={24} edited={edited("shadow")} onChange={(spread) => patch({ spread })} />
        </div>
      )}
      {sh && <ColorRow label="Color" hex={sh.color} alpha={sh.a} edited={edited("shadow")} onChange={(color, a) => patch({ color, a })} />}
    </Folder>
  );
};

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
// `text`: text is written right in it, so its Text folder shows.
export const DesignSection = ({
  selected,
  s,
  base,
  text,
  set,
  size,
  bounds,
}: {
  selected: string | null;
  s: S | null;
  base: S | null;
  text: boolean;
  set: (patch: Partial<S>) => void;
  size: { w: number; h: number };
  bounds: { w: number; h: number };
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
  const props: EditProps = { s, set, edited: (k) => changed.has(k), size, bounds };
  return (
    <>
      <div key={selected} className="pt-1">
        <LayoutFolder {...props} />
        <AppearanceFolder {...props} />
        {text && <TextFolder {...props} />}
        <FillFolder {...props} />
        <BorderFolder {...props} />
        <ShadowFolder {...props} />
      </div>
    </>
  );
};
