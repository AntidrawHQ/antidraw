/**
 * The Design panel's fields, as the confirmed sidebar draws them (the
 * Antidraw workspace's Sidebar02Classic and its controls catalog): soft
 * dark fields on the panel, 28px tall, 6px corners, Geist Mono values, a
 * neutral accent and a sand dot for edits. Number fields scrub by their
 * label, take typed maths (+8, *2) and step with ↑↓ (⇧ ten steps); `step`
 * keeps them on a scale. The dk- classes (fonts, scrubbing) are in
 * index.css.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as RPE } from "react";
import { Check as CheckIcon, ChevronDown, Pipette } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { rgba, type Align, type Sizing } from "@/shared/design";

export const T = {
  divider: "#3A3A3D",
  field: "#38383B",
  fieldHover: "#414144",
  text: "#F2F2F3",
  text2: "#A1A1A6",
  text3: "#78787D",
  accent: "#E8E8EA",
  accentSoft: "rgba(232,232,234,0.14)",
  edited: "#D6C7A1",
  popover: "#323235",
  panel: "#2C2C2E",
};

const MONO = "dk-mono tabular-nums";
const RING = "pointer-events-none absolute inset-0 rounded-[6px] ring-1 ring-inset ring-transparent group-focus-within/num:ring-[#E8E8EA]";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const decimals = (step: number) => (step >= 1 ? 0 : (String(step).split(".")[1]?.length ?? 0));
// The nearest value on the scale `step` makes.
export const snap = (v: number, step: number) => +(Math.round(v / step) * step).toFixed(decimals(step));

// A scrub: the label dragged sideways moves the value one step per 2px (⇧ ten).
const useScrub = (start: () => number, to: (v: number) => void, step: number) => {
  const drag = useRef<{ x: number; v: number } | null>(null);
  return {
    onPointerDown: (e: RPE<HTMLSpanElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, v: start() };
      document.body.classList.add("dk-scrubbing");
    },
    onPointerMove: (e: RPE<HTMLSpanElement>) => {
      const d = drag.current;
      if (d) to(d.v + Math.round((e.clientX - d.x) / 2) * step * (e.shiftKey ? 10 : 1));
    },
    onPointerUp: () => {
      drag.current = null;
      document.body.classList.remove("dk-scrubbing");
    },
  };
};

/* ── Rows and menus ───────────────────────────────────────────────────── */

// A labelled 32px row: 72px label column, then the control.
export const Row = ({ label, children, className }: { label?: ReactNode; children: ReactNode; className?: string }) => (
  <div className={cn("flex min-h-8 items-center gap-2", className)}>
    {label !== undefined && (
      <span className="w-[72px] shrink-0 truncate text-[12px]" style={{ color: T.text2 }}>
        {label}
      </span>
    )}
    <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
  </div>
);

export const Pop = ({ children, className, style }: { children: ReactNode; className?: string; style?: CSSProperties }) => (
  <div className={cn("rounded-[10px] p-2", className)} style={{ background: T.popover, boxShadow: "0 12px 32px rgba(0,0,0,.45), 0 0 0 1px #45454A", ...style }}>
    {children}
  </div>
);

export const MenuItem = ({ children, on, onClick, right }: { children: ReactNode; on?: boolean; onClick?: () => void; right?: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex h-7 w-full items-center gap-2 rounded-[6px] px-2 text-left text-[12px] hover:bg-white/[0.07]"
    style={{ color: T.text }}
  >
    <span className="grid w-3 place-items-center">{on && <CheckIcon className="size-3" />}</span>
    <span className="min-w-0 flex-1 truncate">{children}</span>
    {right}
  </button>
);

// A small menu that opens under its trigger.
export const Menu = ({
  trigger,
  children,
  width = 180,
  align = "right",
  className,
}: {
  trigger: (toggle: () => void, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  width?: number;
  align?: "left" | "right";
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={ref} className={cn("relative", className)}>
      {trigger(() => setOpen((o) => !o), open)}
      {open && (
        <Pop className={cn("absolute top-[calc(100%+4px)] z-50 !p-1", align === "right" ? "right-0" : "left-0")} style={{ width }}>
          {children(() => setOpen(false))}
        </Pop>
      )}
    </div>
  );
};

export const IconBtn = ({ children, tip, on, onClick, className }: { children: ReactNode; tip: string; on?: boolean; onClick?: () => void; className?: string }) => (
  <button
    type="button"
    title={tip}
    aria-label={tip}
    aria-pressed={on}
    onClick={onClick}
    className={cn("grid size-7 shrink-0 place-items-center rounded-[6px] transition-colors hover:bg-[#414144] [&_svg]:size-4", className)}
    style={on ? { background: T.accentSoft, color: T.accent } : { color: T.text2 }}
  >
    {children}
  </button>
);

/* ── Number fields ────────────────────────────────────────────────────── */

// Typed input: numbers, a leading operator on the current value (+8, *2), plain maths.
export const parseNum = (text: string, current: number): number | null => {
  const t = text.trim();
  if (!t) return null;
  const expr = /^[+\-*/]/.test(t) && !/^-\d+(\.\d+)?$/.test(t) ? `${current}${t}` : t;
  if (!/^[\d+\-*/().\s]+$/.test(expr)) return null;
  try {
    const v = Function(`"use strict";return (${expr})`)() as unknown;
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  } catch {
    return null;
  }
};

// The workhorse: drag the label to scrub, type, or ↑↓ to step (⇧ ten
// steps). `null` reads as Mixed; `format` names a value (Full, Auto).
export const Num = ({
  value,
  onChange,
  label,
  unit,
  min = -Infinity,
  max = Infinity,
  step = 1,
  format,
  className,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number) => void;
  label?: ReactNode;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  className?: string;
  placeholder?: string;
}) => {
  const [text, setText] = useState<string | null>(null);
  const cur = value ?? 0;
  const put = (v: number) => onChange(clamp(snap(v, step), min, max));
  const scrub = useScrub(() => cur, put, step);
  return (
    <div
      className={cn("group/num relative flex h-7 min-w-0 items-center rounded-[6px] pr-2 text-[12px]", label === undefined && "pl-2", className)}
      style={{ background: T.field }}
    >
      {label !== undefined && (
        <span {...scrub} className="grid h-full min-w-6 shrink-0 cursor-ew-resize touch-none select-none place-items-center px-1.5 text-[11px]" style={{ color: T.text3 }}>
          {label}
        </span>
      )}
      <input
        value={text ?? (value === null ? "" : (format?.(value) ?? String(value)))}
        placeholder={placeholder ?? "Mixed"}
        onFocus={(e) => (setText(e.target.value), e.target.select())}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null) {
            const v = parseNum(text, cur);
            if (v !== null) put(v);
          }
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") (setText(null), requestAnimationFrame(() => e.currentTarget?.blur()));
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setText(null);
            put(cur + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
          }
        }}
        className={cn(MONO, "h-full w-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#78787D]")}
        style={{ color: T.text }}
      />
      {unit && (
        <span className="shrink-0 pl-1 text-[11px]" style={{ color: T.text3 }}>
          {unit}
        </span>
      )}
      <span className={RING} />
    </div>
  );
};

// A field that only shows text (Auto, Gradient).
export const TextFieldish = ({ label, children, dim, className, title }: { label?: ReactNode; children: ReactNode; dim?: boolean; className?: string; title?: string }) => (
  <div title={title} className={cn("flex h-7 min-w-0 items-center rounded-[6px] pr-2 text-[12px]", !label && "pl-2", className)} style={{ background: T.field }}>
    {label && (
      <span className="grid h-full min-w-6 place-items-center px-1.5 text-[11px]" style={{ color: T.text3 }}>
        {label}
      </span>
    )}
    <span className={cn(MONO, "truncate")} style={{ color: dim ? T.text3 : T.text }}>
      {children}
    </span>
  </div>
);

// Text typed in, kept when it loses focus (Enter), dropped with Esc.
export const TextField = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) => {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="group/num relative flex h-7 min-w-0 items-center rounded-[6px] px-2 text-[12px]" style={{ background: T.field }}>
      <input
        aria-label={label}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          setDraft(null);
          if (e.target.value.trim() && e.target.value !== value) onChange(e.target.value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") (setDraft(null), requestAnimationFrame(() => e.currentTarget?.blur()));
        }}
        className="h-full min-w-0 flex-1 bg-transparent outline-none"
        style={{ color: T.text }}
      />
      <span className={RING} />
    </div>
  );
};

/* ── Options ──────────────────────────────────────────────────────────── */

export type Opt<V extends string> = { v: V; label?: ReactNode; tip?: string };

// Segmented control: a 2px inset track, the chosen segment raised.
export const Seg = <V extends string>({ options, value, onChange, className }: { options: Opt<V>[]; value: V; onChange: (v: V) => void; className?: string }) => (
  <div className={cn("flex h-7 rounded-[6px] p-[2px]", className)} style={{ background: T.field }}>
    {options.map((o) => (
      <button
        key={o.v}
        type="button"
        title={o.tip}
        aria-label={o.tip}
        aria-pressed={value === o.v}
        onClick={() => onChange(o.v)}
        className={cn("grid min-w-0 flex-1 place-items-center rounded-[4px] px-1.5 text-[11.5px] transition-colors", value !== o.v && "hover:text-white")}
        style={value === o.v ? { background: "#4A4A4E", color: T.text, boxShadow: "0 1px 2px rgba(0,0,0,.3)" } : { color: T.text2 }}
      >
        <span className="truncate">{o.label ?? o.v}</span>
      </button>
    ))}
  </div>
);

export const Select = <V extends string>({
  value,
  options,
  onChange,
  render,
  className,
}: {
  value: V;
  options: readonly V[];
  onChange: (v: V) => void;
  render?: (v: V) => ReactNode;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={ref} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          const i = options.indexOf(value) + (e.key === "ArrowDown" ? 1 : -1);
          onChange(options[clamp(i, 0, options.length - 1)]!);
        }}
        className="flex h-7 w-full items-center gap-1.5 rounded-[6px] pl-2 pr-1.5 text-left text-[12px] hover:bg-[#414144] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#E8E8EA]"
        style={{ background: T.field, color: T.text }}
      >
        <span className="min-w-0 flex-1 truncate">{render ? render(value) : value}</span>
        <ChevronDown className="size-3.5 shrink-0" style={{ color: T.text3 }} />
      </button>
      {open && (
        <Pop className="absolute left-0 top-[calc(100%+4px)] z-30 max-h-[220px] overflow-y-auto" style={{ width: "100%" }}>
          {options.map((o) => (
            <MenuItem key={o} on={o === value} onClick={() => (onChange(o), setOpen(false))}>
              {render ? render(o) : o}
            </MenuItem>
          ))}
        </Pop>
      )}
    </div>
  );
};

/* ── Size ─────────────────────────────────────────────────────────────── */

// `W 120 ▾`: a number and how it's decided. Typing a number makes it Fixed
// (`onValue`); typing hug or fill switches.
export const SizeField = ({
  axis,
  value,
  mode,
  measured,
  step,
  onValue,
  onMode,
}: {
  axis: "W" | "H";
  value: number;
  mode: Sizing;
  measured: number;
  step: number;
  onValue: (v: number) => void;
  onMode: (m: Sizing) => void;
}) => {
  const [text, setText] = useState<string | null>(null);
  const shown = mode === "fixed" ? value : measured;
  const fix = (v: number) => onValue(Math.max(0, snap(v, step)));
  const scrub = useScrub(() => shown, fix, step);
  const commit = () => {
    if (text === null) return;
    const t = text.trim().toLowerCase();
    if (t === "hug" || t === "fill") onMode(t);
    else {
      const v = parseNum(t, shown);
      if (v !== null) fix(v);
    }
    setText(null);
  };
  const name = axis === "W" ? "width" : "height";
  return (
    <div className="group/num relative flex h-7 min-w-0 flex-1 items-center rounded-[6px] text-[12px]" style={{ background: T.field }}>
      <span {...scrub} className="grid h-full w-6 shrink-0 cursor-ew-resize touch-none select-none place-items-center text-[11px]" style={{ color: T.text3 }}>
        {axis}
      </span>
      <input
        aria-label={axis === "W" ? "Width" : "Height"}
        value={text ?? String(shown)}
        onFocus={(e) => (setText(String(shown)), e.target.select())}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setText(null);
            fix(shown + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
          }
        }}
        className={cn(MONO, "h-full min-w-0 flex-1 bg-transparent outline-none")}
        style={{ color: mode === "fixed" ? T.text : T.text3 }}
      />
      <Menu
        width={176}
        trigger={(toggle) => (
          <button
            type="button"
            title={`How the ${name} is set`}
            onClick={toggle}
            className="flex h-full items-center gap-0.5 rounded-r-[6px] pl-1 pr-1.5 text-[11px] hover:bg-white/[0.05]"
            style={{ color: mode === "fixed" ? T.text3 : T.text2 }}
          >
            {mode !== "fixed" && (mode === "hug" ? "Hug" : "Fill")}
            <ChevronDown className="size-3" />
          </button>
        )}
      >
        {(close) =>
          (["fixed", "hug", "fill"] as Sizing[]).map((m) => (
            <MenuItem
              key={m}
              on={mode === m}
              onClick={() => (onMode(m), close())}
              right={
                <span className={cn(MONO, "text-[10.5px]")} style={{ color: T.text3 }}>
                  {m === "fixed" ? shown : ""}
                </span>
              }
            >
              {m === "fixed" ? `Fixed ${name}` : m === "hug" ? "Hug contents" : "Fill container"}
            </MenuItem>
          ))
        }
      </Menu>
      <span className={RING} />
    </div>
  );
};

/* ── Alignment ────────────────────────────────────────────────────────── */

// The 3×3 pad: click a dot to place the children, double-click to space
// them out. `jx` / `jy`: where they sit across and down.
export const AlignPad = ({
  dir,
  jx,
  jy,
  between,
  onPick,
  size = 72,
}: {
  dir: "row" | "column";
  jx: Align;
  jy: Align;
  between: boolean;
  onPick: (x: Align, y: Align, dbl: boolean) => void;
  size?: number;
}) => {
  const ks: Align[] = ["start", "center", "end"];
  return (
    <div className="grid shrink-0 grid-cols-3 grid-rows-3 rounded-[6px] p-1" style={{ background: T.field, width: size, height: size }}>
      {ks.map((y) =>
        ks.map((x) => {
          const on = jx === x && jy === y && !between;
          const lineOn = between && (dir === "row" ? jy === y : jx === x);
          return (
            <button
              key={x + y}
              type="button"
              title={`${y} ${x}`}
              onClick={() => onPick(x, y, false)}
              onDoubleClick={() => onPick(x, y, true)}
              className="group grid place-items-center"
            >
              {on || lineOn ? (
                <span
                  className={cn(
                    "flex gap-[2px]",
                    dir === "row" ? "flex-row" : "flex-col",
                    dir === "row"
                      ? y === "start"
                        ? "items-start"
                        : y === "end"
                          ? "items-end"
                          : "items-center"
                      : x === "start"
                        ? "items-start"
                        : x === "end"
                          ? "items-end"
                          : "items-center",
                  )}
                >
                  {[8, 12, 6].map((l, i) => (
                    <span key={i} className="rounded-[1px]" style={{ background: T.accent, ...(dir === "row" ? { width: 2.5, height: l } : { height: 2.5, width: l }) }} />
                  ))}
                </span>
              ) : (
                <span className="size-[3px] rounded-full transition-transform group-hover:scale-150" style={{ background: T.text3 }} />
              )}
            </button>
          );
        }),
      )}
    </div>
  );
};

/* ── Colour ───────────────────────────────────────────────────────────── */

export const checker = "repeating-conic-gradient(#555 0% 25%, #3a3a3a 0% 50%) 50% / 8px 8px";

type HSV = { h: number; s: number; v: number };
const hsvToHex = ({ h, s, v }: HSV) => {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return (
    "#" +
    [f(5), f(3), f(1)]
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
};
const hexToHsv = (hex: string): HSV => {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
};
// Figma-style hex entry: "3" → 333333, "ab" → ababab, "3b8" → 33bb88.
const normHex = (t: string) => {
  let x = t.trim().replace(/^#/, "");
  if (/^[0-9a-f]$/i.test(x)) x = x.repeat(6);
  else if (/^[0-9a-f]{2}$/i.test(x)) x = x.repeat(3);
  else if (/^[0-9a-f]{3}$/i.test(x))
    x = x
      .split("")
      .map((c) => c + c)
      .join("");
  return /^[0-9a-f]{6}$/i.test(x) ? "#" + x.toUpperCase() : null;
};

const HexInput = ({ hex, onChange }: { hex: string; onChange: (h: string) => void }) => {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      aria-label="Hex"
      value={text ?? hex.slice(1)}
      onFocus={(e) => (setText(hex.slice(1)), e.target.select())}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const h = text !== null ? normHex(text) : null;
        if (h) onChange(h);
        setText(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") (setText(null), e.currentTarget.blur());
      }}
      className={cn(MONO, "min-w-0 flex-1 bg-transparent uppercase outline-none")}
      style={{ color: T.text }}
    />
  );
};

const AlphaInput = ({ alpha, onChange }: { alpha: number; onChange: (a: number) => void }) => {
  const [text, setText] = useState<string | null>(null);
  return (
    <span className="flex w-[52px] shrink-0 items-center pr-2">
      <input
        aria-label="Opacity"
        value={text ?? String(alpha)}
        onFocus={(e) => (setText(String(alpha)), e.target.select())}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const v = parseFloat(text ?? "");
          if (Number.isFinite(v)) onChange(clamp(Math.round(v), 0, 100));
          setText(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            setText(null);
            onChange(clamp(alpha + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1), 0, 100));
          }
        }}
        className={cn(MONO, "w-full min-w-0 bg-transparent text-right outline-none")}
        style={{ color: T.text }}
      />
      <span className="pl-0.5 text-[11px]" style={{ color: T.text3 }}>
        %
      </span>
    </span>
  );
};

// Chromium's eyedropper, where there is one.
type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const eyeDropper = () => (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

// Figma's picker: saturation × brightness, hue, opacity, hex + %, eyedropper.
const Picker = ({ hex, alpha, onChange, width = 216 }: { hex: string; alpha: number; onChange: (hex: string, alpha: number) => void; width?: number }) => {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(hex));
  useEffect(() => {
    if (hsvToHex(hsv) !== hex) setHsv((p) => ({ ...hexToHsv(hex), h: hexToHsv(hex).s === 0 ? p.h : hexToHsv(hex).h }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hex]);
  const set = (n: HSV) => (setHsv(n), onChange(hsvToHex(n), alpha));
  const drag = (fn: (x: number, y: number) => void) => (e: RPE<HTMLDivElement>) => {
    const el = e.currentTarget;
    const go = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
    };
    el.setPointerCapture(e.pointerId);
    go(e);
    el.onpointermove = (ev) => ev.buttons && go(ev);
  };
  const hue = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const Dropper = eyeDropper();
  return (
    <div className="flex flex-col gap-2" style={{ width }}>
      <div
        onPointerDown={drag((x, y) => set({ ...hsv, s: x, v: 1 - y }))}
        className="relative h-[140px] cursor-crosshair touch-none rounded-[6px]"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})` }}
      >
        <span
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
        />
      </div>
      <div className="flex items-center gap-2">
        {Dropper && (
          <IconBtn
            tip="Pick a colour from the screen"
            onClick={() =>
              void new Dropper()
                .open()
                .then((r) => onChange(r.sRGBHex.toUpperCase(), alpha))
                .catch(() => {})
            }
          >
            <Pipette />
          </IconBtn>
        )}
        <div className="flex flex-1 flex-col gap-2">
          <div
            onPointerDown={drag((x) => set({ ...hsv, h: x * 360 }))}
            className="relative h-3 cursor-pointer touch-none rounded-full"
            style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
          >
            <span
              className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3)]"
              style={{ left: `${(hsv.h / 360) * 100}%`, background: hue }}
            />
          </div>
          <div
            onPointerDown={drag((x) => onChange(hex, Math.round(x * 100)))}
            className="relative h-3 cursor-pointer touch-none rounded-full"
            style={{ background: `linear-gradient(to right, transparent, ${hex}), ${checker}` }}
          >
            <span
              className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3)]"
              style={{ left: `${alpha}%`, background: rgba(hex, alpha) }}
            />
          </div>
        </div>
      </div>
      <div className="flex gap-1.5">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] px-2 text-[12px]" style={{ background: T.field }}>
          <span className="text-[11px]" style={{ color: T.text3 }}>
            Hex
          </span>
          <HexInput hex={hex} onChange={(h) => onChange(h, alpha)} />
        </div>
        <Num value={alpha} onChange={(a) => onChange(hex, a)} min={0} max={100} unit="%" className="w-[64px]" />
      </div>
    </div>
  );
};

// `[swatch] [hex] [opacity %]`: the swatch opens the picker.
export const ColorRow = ({ hex, alpha, onChange, right }: { hex: string; alpha: number; onChange: (hex: string, alpha: number) => void; right?: ReactNode }) => (
  <div className="flex items-center gap-1">
    <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] pl-1.5 text-[12px]" style={{ background: T.field }}>
      <Menu
        align="left"
        width={232}
        trigger={(toggle) => (
          <button
            type="button"
            aria-label="Pick a colour"
            onClick={toggle}
            className="relative size-[18px] shrink-0 overflow-hidden rounded-[4px]"
            style={{ background: checker, boxShadow: "inset 0 0 0 1px rgba(255,255,255,.1)" }}
          >
            <span className="absolute inset-0" style={{ background: rgba(hex, alpha) }} />
          </button>
        )}
      >
        {() => (
          <div className="p-1">
            <Picker hex={hex} alpha={alpha} onChange={onChange} />
          </div>
        )}
      </Menu>
      <HexInput hex={hex} onChange={(h) => onChange(h, alpha)} />
      <span className="h-full w-px" style={{ background: T.panel }} />
      <AlphaInput alpha={alpha} onChange={(a) => onChange(hex, a)} />
    </div>
    {right}
  </div>
);

/* ── Icons ────────────────────────────────────────────────────────────── */

export const Corner = () => (
  <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path d="M2 11V7a5 5 0 0 1 5-5h4" />
  </svg>
);

export const DropShadowIcon = () => (
  <span className="relative block size-3.5">
    <span className="absolute left-1 top-1 size-2.5 rounded-[2px] bg-current opacity-30" />
    <span className="absolute left-0 top-0 size-2.5 rounded-[2px] border border-current" />
  </span>
);
