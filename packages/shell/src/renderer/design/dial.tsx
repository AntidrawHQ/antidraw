/**
 * The Design panel's controls: DialKit's, redrawn for antidraw's right panel
 * (not the library: its control designs). Measurements follow
 * dialkit/dist/styles.css:
 *   surface white/5 · hover white/10 · active white/11 · subtle white/6
 *   label white/70 · primary white/95 · tertiary white/40
 *   row 36px · gap 6px · radius 8px · 13px/500 labels · Geist Mono values
 * One addition for antidraw: `edited` tints a value blue, a control changed
 * but not yet applied. The dk- classes (fonts, shimmer, scrollbar) are in
 * index.css.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { rgba, type Align } from "@/shared/design";

// --dial-row-height: 36px. A panel sets --dk-row for density (the right panel: 30px).
export const ROW = "h-[var(--dk-row,36px)]";
export const SURFACE = "rounded-lg bg-white/[0.05]";
export const MONO = "dk-mono";
const EDITED = "text-[#93c5fd]";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const decimals = (step: number) => (step >= 1 ? 0 : Math.min(3, String(step).split(".")[1]?.length ?? 0));
const snap = (n: number, step: number, min: number) => +(Math.round((n - min) / step) * step + min).toFixed(decimals(step));

/* ── Folder ────────────────────────────────────────────────────────────── */

// A section: 13px/600 title at white/70, the caret at the right, hairlines
// above. `actions` sit before the caret (a fill's + / −). `dot` marks a
// folder holding edits while it's closed.
export const Folder = ({
  title,
  children,
  actions,
  defaultOpen = true,
  dot,
}: {
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  dot?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const empty = !children || (Array.isArray(children) && children.every((c) => !c));
  return (
    <section className="border-t border-white/[0.06] px-3 first:border-t-0">
      <div className={cn("group flex items-center gap-1", ROW)}>
        <button type="button" onClick={() => setOpen(!open)} className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left">
          <span className="translate-y-[-0.5px] text-[13px] font-semibold tracking-[-0.01em] text-white/70 group-hover:text-white/90">{title}</span>
          {dot && !open && <span className="size-[5px] rounded-full bg-[#60a5fa]" />}
        </button>
        {actions}
        {!empty && (
          <button
            type="button"
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            onClick={() => setOpen(!open)}
            className="grid size-5 cursor-pointer place-items-center text-white/70 opacity-60 hover:opacity-100"
          >
            <ChevronDown className={cn("size-4", !open && "-rotate-90")} strokeWidth={2} />
          </button>
        )}
      </div>
      {open && !empty && <div className="flex flex-col gap-1.5 pb-3">{children}</div>}
    </section>
  );
};

/* ── Slider ────────────────────────────────────────────────────────────── */

// The whole row is the track: press anywhere to set, drag to scrub, ← → to
// step (⇧ ten). The fill runs to the value; a 3px handle wakes on hover and
// steps aside near the label or value; hashmarks show while active. Click
// the value to type one.
export const Slider = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  unit,
  edited,
  dim,
  className,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  unit?: string;
  edited?: boolean;
  // The value isn't set here (a hugging width): it reads at white/40.
  dim?: boolean;
  className?: string;
}) => {
  const wrap = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const active = hover || drag;
  const pct = clamp((value - min) / (max - min), 0, 1) * 100;

  const at = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return clamp(snap(min + clamp((clientX - r.left) / r.width, 0, 1) * (max - min), step, min), min, max);
  };

  // dialkit's dodge: the handle fades where it would cross the label or value.
  const [dodge, setDodge] = useState(false);
  useLayoutEffect(() => {
    const w = wrap.current?.offsetWidth;
    if (!w) return;
    const left = ((10 + (labelRef.current?.offsetWidth ?? 0) + 8) / w) * 100;
    const right = ((w - 12 - (valueRef.current?.offsetWidth ?? 0) - 8) / w) * 100;
    setDodge(pct < left || pct > right);
  }, [pct, value]);
  const handleOpacity = !active ? 0 : dodge ? 0.1 : drag ? 0.9 : 0.5;

  const shown = format ? format(value) : value.toFixed(decimals(step));
  const commit = (raw: string) => {
    setTyping(null);
    const n = parseFloat(raw);
    if (Number.isFinite(n)) onChange(clamp(snap(n, step, min), min, max));
  };

  return (
    <div ref={wrap} className={cn("relative", ROW, className)}>
      <div
        role="slider"
        tabIndex={0}
        aria-label={typeof label === "string" ? label : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onPointerDown={(e) => {
          if ((e.target as Element).closest("[data-value]")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag(true);
          onChange(at(e.clientX));
        }}
        onPointerMove={(e) => drag && onChange(at(e.clientX))}
        onPointerUp={() => setDrag(false)}
        onPointerCancel={() => setDrag(false)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const by = (e.key === "ArrowRight" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
          onChange(clamp(snap(value + by, step, min), min, max));
        }}
        className={cn(
          "absolute inset-0 cursor-pointer touch-none select-none overflow-hidden outline-none focus-visible:ring-1 focus-visible:ring-white/60",
          SURFACE,
        )}
      >
        {/* fill */}
        <div
          className={cn("pointer-events-none absolute inset-y-0 left-0", active ? "bg-white/[0.15]" : "bg-white/[0.11]")}
          style={{ width: `${pct}%` }}
        />
        {/* hashmarks, while active */}
        {Array.from({ length: 9 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "pointer-events-none absolute top-1/2 h-2 w-px -translate-x-1/2 -translate-y-1/2 rounded-full",
              active ? "bg-white/[0.15]" : "bg-transparent",
            )}
            style={{ left: `${(i + 1) * 10}%` }}
          />
        ))}
        {/* handle */}
        <span
          className="pointer-events-none absolute top-1/2 h-5 w-[3px] rounded-full bg-white/95"
          style={{
            left: `clamp(4px, ${pct}%, calc(100% - 7px))`,
            opacity: handleOpacity,
            transform: `translateY(-50%) scale(${active ? 1 : 0.25}, ${active && dodge ? 0.75 : 1})`,
          }}
        />
        <span
          ref={labelRef}
          className="pointer-events-none absolute left-2.5 top-1/2 inline-flex translate-y-[calc(-50%-0.5px)] items-center gap-1.5 text-[13px] font-medium text-white/70"
        >
          {label}
        </span>
        {typing === null ? (
          <span
            ref={valueRef}
            data-value
            onClick={() => setTyping(String(value))}
            className={cn(
              MONO,
              "absolute right-3 top-1/2 translate-y-[calc(-50%+0.5px)] cursor-text border-b border-transparent pb-px text-[13px] font-medium tabular-nums hover:border-white/50",
              edited ? EDITED : dim ? "text-white/40" : active ? "text-white" : "text-white/70",
            )}
          >
            {shown}
            {unit && <span className="text-white/40">{unit}</span>}
          </span>
        ) : (
          <input
            data-value
            autoFocus
            value={typing}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setTyping(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commit(e.currentTarget.value);
              if (e.key === "Escape") setTyping(null);
            }}
            className={cn(
              MONO,
              "absolute right-3 top-1/2 w-[6ch] -translate-y-1/2 border-b border-white/70 bg-transparent pb-px text-right text-[13px] font-medium text-white outline-none",
            )}
          />
        )}
      </div>
    </div>
  );
};

/* ── Segmented ─────────────────────────────────────────────────────────── */

export type Opt<T extends string> = { value: T; label: ReactNode; title?: string };

// A pill slides to the picked option. Bare inside a LabeledRow; `full`
// gives it its own surface across the row.
export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  full,
  className,
}: {
  options: Opt<T>[];
  value: T | null;
  onChange: (v: T) => void;
  full?: boolean;
  className?: string;
}) => {
  return (
    <div className={cn("relative flex p-0.5", full && cn(SURFACE, ROW, "w-full"), className)}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-label={o.title}
            aria-pressed={on}
            onClick={() => !on && onChange(o.value)}
            className={cn(
              "relative grid cursor-pointer place-items-center px-2 py-1.5 text-[13px] font-medium",
              full && "flex-1",
              on ? "text-white/95" : "text-white/60 hover:text-white/85",
            )}
          >
            {on && <span className="absolute inset-0 rounded-md bg-white/[0.11]" />}
            <span className="relative flex items-center">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
};

// Label left, control right, on one surface (dialkit-labeled-control).
export const LabeledRow = ({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) => (
  <div className={cn("flex items-center justify-between gap-3 pl-3 pr-0.5", ROW, SURFACE, className)}>
    <span className="flex shrink-0 items-center text-[13px] font-medium text-white/70">{label}</span>
    {children}
  </div>
);

/* ── Toggle ────────────────────────────────────────────────────────────── */

export const Toggle = ({
  label,
  checked,
  onChange,
  edited,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  edited?: boolean;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={cn("flex w-full cursor-pointer select-none items-center justify-between px-3 hover:bg-white/10", ROW, SURFACE)}
  >
    <span className={cn("text-[13px] font-medium", edited ? EDITED : checked ? "text-white/95" : "text-white/70")}>{label}</span>
    <span className={cn("relative h-5 w-9 rounded-full", checked ? "bg-white/[0.22]" : "bg-white/[0.11]")}>
      <span className="absolute top-0.5 size-4 rounded-full bg-white/95 shadow-[0_1px_2px_rgba(0,0,0,.3)]" style={{ left: checked ? 18 : 2 }} />
    </span>
  </button>
);

/* ── Select ────────────────────────────────────────────────────────────── */

// The trigger is a row (label left, value and chevron right); the list
// opens under it on the glass surface. `label` omitted: a compact trigger.
export const Select = <T extends string>({
  label,
  value,
  options,
  onChange,
  edited,
  className,
}: {
  label?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  edited?: boolean;
  className?: string;
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        data-open={open}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-2 text-[13px] font-medium hover:bg-white/10",
          label ? "pl-3 pr-2" : "pl-2.5 pr-1.5",
          ROW,
          SURFACE,
          open && "bg-white/[0.11]",
        )}
      >
        {label && <span className="shrink-0 translate-y-[-0.5px] text-white/70">{label}</span>}
        <span className={cn("flex min-w-0 items-center gap-1", !label && "flex-1 justify-between")}>
          <span className={cn("truncate translate-y-[-0.5px]", edited ? EDITED : "text-white/70")}>{current}</span>
          <ChevronDown className="size-4 shrink-0 text-white/70 opacity-60" strokeWidth={2} />
        </span>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+4px)] z-50 min-w-full origin-top rounded-lg border border-white/10 bg-[#212121] p-1 shadow-[0_8px_24px_rgba(0,0,0,.4)]">
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-h-8 w-full cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-md px-2.5 text-left text-[13px] font-medium hover:bg-white/10",
                  on ? "bg-white/[0.11] text-white/95" : "text-white/70",
                )}
              >
                {o.label}
                {on && <Check className="size-3.5 text-white/70" strokeWidth={2} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ── Color ─────────────────────────────────────────────────────────────── */

// Label left; hex, opacity and the swatch right. The swatch opens the
// system picker; hex and opacity are typed.
export const ColorRow = ({
  label,
  hex,
  alpha,
  onChange,
  edited,
}: {
  label: string;
  hex: string;
  alpha: number;
  onChange: (hex: string, alpha: number) => void;
  edited?: boolean;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [aDraft, setADraft] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const commitHex = (raw: string) => {
    setDraft(null);
    const m = raw.replace("#", "").trim();
    const full =
      m.length === 3
        ? m
            .split("")
            .map((c) => c + c)
            .join("")
        : m;
    if (/^[0-9a-f]{6}$/i.test(full)) onChange(`#${full.toUpperCase()}`, alpha);
  };
  const commitA = (raw: string) => {
    setADraft(null);
    const n = parseFloat(raw);
    if (Number.isFinite(n)) onChange(hex, clamp(Math.round(n), 0, 100));
  };
  const text = cn(MONO, "bg-transparent text-[13px] font-medium outline-none focus:text-white", edited ? EDITED : "text-white/70");
  return (
    <div className={cn("flex items-center justify-between gap-3 pl-3 pr-2", ROW, SURFACE)}>
      <span className="shrink-0 translate-y-[-0.5px] text-[13px] font-medium text-white/70">{label}</span>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <input
          value={draft ?? hex.replace("#", "")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={cn(text, "w-[7ch] min-w-0 text-right uppercase")}
        />
        <span className="h-3 w-px bg-white/10" />
        <span className="flex items-baseline">
          <input
            value={aDraft ?? String(alpha)}
            onChange={(e) => setADraft(e.target.value)}
            onBlur={(e) => commitA(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className={cn(text, "w-[3ch] text-right")}
          />
          <span className={cn(MONO, "text-[13px] text-white/40")}>%</span>
        </span>
        <button
          type="button"
          aria-label={`Pick ${label.toLowerCase()}`}
          onClick={() => picker.current?.click()}
          className="relative size-5 shrink-0 cursor-pointer overflow-hidden rounded-[5px] border border-white/15"
          style={{
            background: `linear-gradient(${rgba(hex, alpha)}, ${rgba(hex, alpha)}), repeating-conic-gradient(#aaa 0% 25%, #eee 0% 50%) 0 / 8px 8px`,
            boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 8%)",
          }}
        >
          <input
            ref={picker}
            type="color"
            value={hex.toLowerCase()}
            onChange={(e) => onChange(e.target.value.toUpperCase(), alpha)}
            className="pointer-events-none absolute inset-0 opacity-0"
            tabIndex={-1}
          />
        </button>
      </div>
    </div>
  );
};

/* ── Text ──────────────────────────────────────────────────────────────── */

export const TextRow = ({ label, value, onChange, edited }: { label: string; value: string; onChange: (v: string) => void; edited?: boolean }) => {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className={cn("flex items-center justify-between gap-3 px-3", ROW, SURFACE)}>
      <span className="shrink-0 text-[13px] font-medium text-white/70">{label}</span>
      <input
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          setDraft(null);
          if (e.target.value.trim() && e.target.value !== value) onChange(e.target.value.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className={cn(
          "min-w-0 flex-1 bg-transparent text-right text-[13px] font-medium outline-none placeholder:text-white/40 focus:text-white",
          edited ? EDITED : "text-white/70",
        )}
      />
    </label>
  );
};

/* ── Align pad ─────────────────────────────────────────────────────────── */

const SPOTS: Align[] = ["start", "center", "end"];

// Where a flex container's children sit, on dialkit's XY-pad surface: nine
// spots, the picked one a white bar along the main axis (as the slider's
// handle). With space between, the main axis is spread.
export const AlignPad = ({
  direction,
  main,
  cross,
  between,
  onChange,
  edited,
  size = "calc(var(--dk-row, 36px) * 2 + 6px)",
}: {
  direction: "row" | "column";
  main: Align;
  cross: Align;
  between: boolean;
  onChange: (main: Align, cross: Align) => void;
  edited?: boolean;
  size?: number | string;
}) => (
  <div className={cn("relative grid shrink-0 grid-cols-3 grid-rows-3 p-1.5", SURFACE)} style={{ width: size, height: size }}>
    {/* the pad's faint crosshair */}
    <span className="pointer-events-none absolute inset-y-2 left-1/2 w-px -translate-x-1/2 bg-white/[0.06]" />
    <span className="pointer-events-none absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-white/[0.06]" />
    {SPOTS.flatMap((y) =>
      SPOTS.map((x) => {
        const [m, c] = direction === "row" ? [x, y] : [y, x];
        const on = (between || m === main) && c === cross;
        return (
          <button
            key={x + y}
            type="button"
            aria-label={`Align ${y === "center" ? "middle" : y === "start" ? "top" : "bottom"} ${x === "center" ? "center" : x === "start" ? "left" : "right"}`}
            onClick={() => onChange(m, c)}
            className="group relative grid cursor-pointer place-items-center"
          >
            {on ? (
              <span className={cn("rounded-full", edited ? "bg-[#93c5fd]" : "bg-white/95", direction === "row" ? "h-3 w-[3px]" : "h-[3px] w-3")} />
            ) : (
              <span className="size-[3px] rounded-full bg-white/30 group-hover:bg-white/80" />
            )}
          </button>
        );
      }),
    )}
  </div>
);

/* ── Small buttons ─────────────────────────────────────────────────────── */

export const IconButton = ({
  title,
  onClick,
  children,
  active,
  className,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
  className?: string;
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      "grid size-6 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-white/10",
      active ? "bg-white/[0.11] text-white/95" : "text-white/50 hover:text-white/90",
      className,
    )}
  >
    {children}
  </button>
);

// dialkit-button: a full row that does something.
export const RowButton = ({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      "flex w-full cursor-pointer items-center justify-center gap-1.5 text-[13px] font-medium text-white/60 hover:bg-white/10 hover:text-white/95 active:bg-white/[0.11]",
      ROW,
      SURFACE,
      className,
    )}
  >
    {children}
  </button>
);
