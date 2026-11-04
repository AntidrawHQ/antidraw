/**
 * Antidraw's design panel and edit bar, ported for the designer stories from
 * the real app (packages/shell/src/renderer/design), with the stores, inputs
 * and scrub handlers stripped so a timeline drives every value:
 *
 *  - RightPanelShell / Tabs     design/RightPanel.tsx (aside, 13px tabs, PanelRightClose)
 *  - Section, Num, SizeField,   design/sections.tsx + design/kit.tsx (T tokens, 28px fields,
 *    Seg, Select, AlignPad,       6px corners, Geist Mono values, the sand "edited" dot)
 *    ColorRow, Picker, Pop
 *  - SelectEmpty                design/sections.tsx Empty ("Select an element")
 *  - EditBar / ChangeList       design/EditBar.tsx (Precise edits, N unsaved changes, Reset,
 *                               Apply to code in ocean blue, the "agent is applying" pill)
 */
import { ArrowDown, ArrowRight, ArrowUp, Check, ChevronDown, Eye, FoldVertical, Minus, PanelRightClose, Plus, Scan, SquareDashedMousePointer, TextAlignCenter, TextAlignEnd, TextAlignJustify, TextAlignStart, TextWrap } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"

import { cn } from "@/lib/utils"

export const T = {
  divider: "#3A3A3A",
  field: "#373737",
  fieldHover: "#404040",
  text: "#F2F2F2",
  text2: "#A1A1A1",
  text3: "#787878",
  accent: "#E8E8E8",
  accentSoft: "rgba(232,232,232,0.14)",
  edited: "#D6C7A1",
  popover: "#323232",
  panel: "#2A2A2A",
}
export const MONO = "font-['Geist_Mono',ui-monospace,SFMono-Regular,Menlo,monospace] tabular-nums"
const LINE = "#333333"
const OCEAN = "#236CB6"
const RAIL: CSSProperties = { background: "#262626", boxShadow: "0 4px 16px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06)" }
const checker = "repeating-conic-gradient(#555 0% 25%, #3a3a3a 0% 50%) 50% / 8px 8px"

/* ── Panel chrome ─────────────────────────────────────────────────────── */

export function RightPanelShell({ tab = "design", edited, drafts, children, foot, className }: { tab?: "design" | "comments"; edited?: boolean; drafts?: number; children: ReactNode; foot?: ReactNode; className?: string }) {
  return (
    <aside className={cn("relative h-full overflow-hidden border-l border-[#333] bg-[#2A2A2A] font-['Geist','Geist_Sans',-apple-system,BlinkMacSystemFont,sans-serif] text-white antialiased", className)}>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 items-center justify-between border-b border-[#333] p-2">
          <div className="flex items-center gap-0.5">
            {(["design", "comments"] as const).map((t) => {
              const on = t === tab
              return (
                <span key={t} className={cn("relative flex h-6 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium", on ? "text-white/85" : "text-white/40")}>
                  {on && <span className="absolute inset-0 rounded-md bg-white/[0.06]" />}
                  <span className="relative">{t === "design" ? "Design" : "Comments"}</span>
                  {t === "design" && edited && <span className="relative size-1 rounded-full bg-[#60a5fa]/80" />}
                  {t === "comments" && !!drafts && <span className={cn(MONO, "relative text-[11px] text-white/30")}>{drafts}</span>}
                </span>
              )
            })}
          </div>
          <span className="grid size-6 place-items-center rounded-md text-white/30">
            <PanelRightClose className="size-3.5" strokeWidth={1.75} />
          </span>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="pb-3">{children}</div>
        </div>
        {foot}
      </div>
    </aside>
  )
}

export function SelectEmpty() {
  return (
    <div className="flex flex-col gap-4 px-3 pt-5">
      <div className="flex flex-col items-start gap-3 px-1">
        <span className="grid size-9 place-items-center rounded-lg bg-white/[0.05] text-white/60">
          <SquareDashedMousePointer className="size-4" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-white/85">Select an element</span>
          <p className="m-0 text-[12.5px] leading-[18px] text-white/45">Pick the Inspect tool (I), then click inside a frame to edit its layout, type, fill and effects. Edits show in the frame at once; Apply hands them to the agent.</p>
        </div>
      </div>
    </div>
  )
}

/** The column of sections (DesignSection): first section skips its hairline. */
export function Sections({ children }: { children: ReactNode }) {
  return <div className="flex flex-col pb-6 text-[12px] [&>section:first-of-type]:border-t-0">{children}</div>
}

export function Section({ title, dirty, actions, empty, children }: { title: string; dirty?: boolean; actions?: ReactNode; empty?: boolean; children?: ReactNode }) {
  return (
    <section className="border-t px-4" style={{ borderColor: LINE }}>
      <div className="flex h-10 items-center gap-1.5">
        <span className="text-[11.5px] font-medium" style={{ color: empty ? T.text2 : T.text }}>
          {title}
        </span>
        {dirty && <span className="size-[5px] rounded-full" style={{ background: T.edited }} />}
        <span className="flex-1" />
        <div className="-mr-1.5 flex items-center">{actions}</div>
      </div>
      {!empty && <div className="flex flex-col gap-2 pb-4">{children}</div>}
    </section>
  )
}

export const Add = () => (
  <IconBtn>
    <Plus />
  </IconBtn>
)

/* ── Fields ───────────────────────────────────────────────────────────── */

export function IconBtn({ children, on, className }: { children: ReactNode; on?: boolean; className?: string }) {
  return (
    <span className={cn("grid size-7 shrink-0 place-items-center rounded-[6px] [&_svg]:size-4", className)} style={on ? { background: T.accentSoft, color: T.accent } : { color: T.text2 }}>
      {children}
    </span>
  )
}

/** A number field; `focus` draws the field's focus ring, `scrub` lights the label as it's dragged. */
export function Num({ value, label, unit, className, focus, scrub, flash }: { value: ReactNode; label?: ReactNode; unit?: string; className?: string; focus?: boolean; scrub?: boolean; flash?: boolean }) {
  return (
    <div className={cn("relative flex h-7 min-w-0 items-center rounded-[6px] pr-2 text-[12px]", label === undefined && "pl-2", className)} style={{ background: T.field }}>
      {label !== undefined && (
        <span className="grid h-full min-w-6 shrink-0 place-items-center px-1.5 text-[11px] transition-colors" style={{ color: scrub ? T.text : T.text3 }}>
          {label}
        </span>
      )}
      <span className={cn(MONO, "min-w-0 flex-1 truncate transition-colors")} style={{ color: flash ? "#fff" : T.text }}>
        {value}
      </span>
      {unit && (
        <span className="shrink-0 pl-1 text-[11px]" style={{ color: T.text3 }}>
          {unit}
        </span>
      )}
      <span className={cn("pointer-events-none absolute inset-0 rounded-[6px] ring-1 ring-inset", focus ? "ring-[#E8E8E8]" : "ring-transparent")} />
    </div>
  )
}

export function SizeField({ axis, value, mode = "fixed" }: { axis: "W" | "H"; value: number; mode?: "fixed" | "hug" | "fill" }) {
  return (
    <div className="relative flex h-7 min-w-0 flex-1 items-center rounded-[6px] text-[12px]" style={{ background: T.field }}>
      <span className="grid h-full w-6 shrink-0 place-items-center text-[11px]" style={{ color: T.text3 }}>
        {axis}
      </span>
      <span className={cn(MONO, "min-w-0 flex-1")} style={{ color: mode === "fixed" ? T.text : T.text3 }}>
        {Math.round(value)}
      </span>
      <span className="flex h-full items-center gap-0.5 rounded-r-[6px] pr-1.5 pl-1 text-[11px]" style={{ color: mode === "fixed" ? T.text3 : T.text2 }}>
        {mode !== "fixed" && (mode === "hug" ? "Hug" : "Fill")}
        <ChevronDown className="size-3" />
      </span>
    </div>
  )
}

export function Seg({ options, value, className }: { options: { v: string; label: ReactNode }[]; value: string; className?: string }) {
  return (
    <div className={cn("flex h-7 rounded-[6px] p-[2px]", className)} style={{ background: T.field }}>
      {options.map((o) => (
        <span
          key={o.v}
          className="grid min-w-0 flex-1 place-items-center rounded-[4px] px-1.5 text-[11.5px]"
          style={value === o.v ? { background: "#4A4A4A", color: T.text, boxShadow: "0 1px 2px rgba(0,0,0,.3)" } : { color: T.text2 }}
        >
          <span className="truncate">{o.label}</span>
        </span>
      ))}
    </div>
  )
}

export const FLOW_OPTS = [
  { v: "none", label: <Scan className="size-3.5" /> },
  { v: "column", label: <ArrowDown className="size-3.5" /> },
  { v: "row", label: <ArrowRight className="size-3.5" /> },
  { v: "wrap", label: <TextWrap className="size-3.5" /> },
]
export const TALIGN_OPTS = [
  { v: "left", label: <TextAlignStart className="size-3.5" /> },
  { v: "center", label: <TextAlignCenter className="size-3.5" /> },
  { v: "right", label: <TextAlignEnd className="size-3.5" /> },
  { v: "justify", label: <TextAlignJustify className="size-3.5" /> },
]

export function Select({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <span className="flex h-7 w-full items-center gap-1.5 rounded-[6px] pr-1.5 pl-2 text-left text-[12px]" style={{ background: T.field, color: T.text }}>
        <span className="min-w-0 flex-1 truncate">{children}</span>
        <ChevronDown className="size-3.5 shrink-0" style={{ color: T.text3 }} />
      </span>
    </div>
  )
}

export function TextField({ value }: { value: string }) {
  return (
    <div className="relative flex h-7 min-w-0 items-center rounded-[6px] px-2 text-[12px]" style={{ background: T.field, color: T.text }}>
      <span className="truncate">{value}</span>
    </div>
  )
}

export function LineHeight({ value }: { value: number }) {
  return (
    <div className="relative flex h-7 min-w-0 flex-1 items-center rounded-[6px] pr-2 text-[12px]" style={{ background: T.field }}>
      <span className="grid h-full w-7 shrink-0 place-items-center" style={{ color: T.text3 }}>
        <FoldVertical className="size-3.5" />
      </span>
      <span className={MONO} style={{ color: value ? T.text : T.text2 }}>
        {value || "Auto"}
      </span>
    </div>
  )
}

/** The 3×3 alignment pad (one chosen cell drawn as three bars). */
export function AlignPad({ dir, jx, jy, size = 64 }: { dir: "row" | "column"; jx: number; jy: number; size?: number }) {
  return (
    <div className="grid shrink-0 grid-cols-3 grid-rows-3 rounded-[6px] p-1" style={{ background: T.field, width: size, height: size }}>
      {[0, 1, 2].map((y) =>
        [0, 1, 2].map((x) => (
          <span key={`${x}${y}`} className="grid place-items-center">
            {x === jx && y === jy ? (
              <span className={cn("flex gap-[2px]", dir === "row" ? "flex-row items-start" : "flex-col items-start")}>
                {[8, 12, 6].map((l, i) => (
                  <span key={i} className="rounded-[1px]" style={{ background: T.accent, ...(dir === "row" ? { width: 2.5, height: l } : { height: 2.5, width: l }) }} />
                ))}
              </span>
            ) : (
              <span className="size-[3px] rounded-full" style={{ background: T.text3 }} />
            )}
          </span>
        )),
      )}
    </div>
  )
}

/** `[swatch] [hex] [opacity %]` (kit.tsx ColorRow). `ring` marks the swatch as pressed/open. */
export function ColorRow({ hex, alpha = 100, right, open }: { hex: string; alpha?: number; right?: ReactNode; open?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] pl-1.5 text-[12px]" style={{ background: T.field }}>
        <span className="relative size-[18px] shrink-0 overflow-hidden rounded-[4px]" style={{ background: checker, boxShadow: open ? "inset 0 0 0 1px rgba(255,255,255,.1), 0 0 0 1.5px #E8E8E8" : "inset 0 0 0 1px rgba(255,255,255,.1)" }}>
          <span className="absolute inset-0" style={{ background: hex, opacity: alpha / 100 }} />
        </span>
        <span className={cn(MONO, "min-w-0 flex-1 uppercase")} style={{ color: T.text }}>
          {hex.replace("#", "")}
        </span>
        <span className="h-full w-px" style={{ background: T.panel }} />
        <span className="flex w-[52px] shrink-0 items-center justify-end pr-2">
          <span className={MONO} style={{ color: T.text }}>
            {alpha}
          </span>
          <span className="pl-0.5 text-[11px]" style={{ color: T.text3 }}>
            %
          </span>
        </span>
      </div>
      {right}
    </div>
  )
}

export const RemoveBtn = () => (
  <IconBtn>
    <Minus />
  </IconBtn>
)
export const EyeBtn = () => (
  <IconBtn>
    <Eye />
  </IconBtn>
)

export function Corner() {
  return (
    <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M2 11V7a5 5 0 0 1 5-5h4" />
    </svg>
  )
}

/* ── Colour picker (kit.tsx Picker, in its Pop) ───────────────────────── */

export type HSV = { h: number; s: number; v: number }
export function hsvToHex({ h, s, v }: HSV) {
  const f = (n: number) => {
    const k = (n + h / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return "#" + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase()
}

export function Picker({ hsv, alpha = 100, width = 216 }: { hsv: HSV; alpha?: number; width?: number }) {
  const hex = hsvToHex(hsv)
  const hue = hsvToHex({ h: hsv.h, s: 1, v: 1 })
  return (
    <div className="rounded-[10px] !p-1" style={{ background: T.popover, boxShadow: "0 12px 32px rgba(0,0,0,.45), 0 0 0 1px #454545" }}>
      <div className="p-1">
        <div className="flex flex-col gap-2" style={{ width }}>
          <div className="relative h-[140px] rounded-[6px]" style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hue})` }}>
            <span className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3)]" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
          </div>
          <div className="flex flex-col gap-2">
            <div className="relative h-3 rounded-full" style={{ background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}>
              <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3)]" style={{ left: `${(hsv.h / 360) * 100}%`, background: hue }} />
            </div>
            <div className="relative h-3 rounded-full" style={{ background: `linear-gradient(to right, transparent, ${hex}), ${checker}` }}>
              <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3)]" style={{ left: `${alpha}%`, background: hex }} />
            </div>
          </div>
          <div className="flex gap-1.5">
            <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-[6px] px-2 text-[12px]" style={{ background: T.field }}>
              <span className="text-[11px]" style={{ color: T.text3 }}>
                Hex
              </span>
              <span className={cn(MONO, "uppercase")} style={{ color: T.text }}>
                {hex.slice(1)}
              </span>
            </div>
            <Num value={alpha} unit="%" className="w-[64px]" />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Edit bar (design/EditBar.tsx) ────────────────────────────────────── */

export type BarChange = { label: string; from: string; to: string }
export type BarElement = { name: string; changes: BarChange[] }

const Spin = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" className="shrink-0 animate-spin text-white/60" style={{ animationDuration: "1.1s" }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
)

/**
 * The bar at the canvas's top centre. `elements` holds the unsaved changes;
 * `open` shows their list; `applying` is the pill while the agent writes them.
 */
export function EditBar({ elements, open, applying, press, className }: { elements: BarElement[]; open?: boolean; applying?: { n: number; els: number } | null; press?: number; className?: string }) {
  const n = elements.reduce((a, e) => a + e.changes.length, 0)
  const els = elements.length
  return (
    <div className={cn("pointer-events-none absolute top-3 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-1.5 font-['Geist','Geist_Sans',-apple-system,BlinkMacSystemFont,sans-serif] text-white", className)}>
      <div className="relative">
        <div className="flex h-10 items-center gap-1 rounded-[12px] p-1 pl-3" style={RAIL}>
          <SquareDashedMousePointer className="size-4 shrink-0 text-white/55" strokeWidth={1.75} />
          <span className="ml-2 text-[13px] font-medium whitespace-nowrap text-white/90">Precise edits</span>
          <span className="ml-1.5 h-4 w-px bg-white/10" />
          {n === 0 ? (
            <span className="ml-0.5 px-2 text-[13px] whitespace-nowrap text-white/45">No changes yet</span>
          ) : (
            <span className={cn("ml-0.5 flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13px] whitespace-nowrap text-white/85", open && "bg-white/[0.06]")}>
              <span>
                <span className={cn(MONO, "text-[12.5px]")}>{n}</span> unsaved {n === 1 ? "change" : "changes"}
                {els > 1 && <span className="text-white/45"> on {els} elements</span>}
              </span>
              <ChevronDown className={cn("size-3.5 text-white/45 transition-transform", open && "rotate-180")} />
            </span>
          )}
          <span className="w-3" />
          <span className={cn("flex h-8 items-center rounded-[8px] bg-white/[0.07] px-3 text-[13px] font-medium text-white/80", n === 0 && "opacity-40")}>Reset</span>
          <span
            className={cn("flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium whitespace-nowrap text-white transition-opacity", n === 0 && "opacity-40")}
            style={{ background: OCEAN, transform: press ? `scale(${1 - press * 0.06})` : undefined, filter: press ? `brightness(${1 + press * 0.15})` : undefined }}
          >
            Apply to code
            <ArrowUp className="size-3.5" />
          </span>
        </div>
        {open && n > 0 && (
          <div className="absolute top-[calc(100%+6px)] right-0 left-0 z-10 min-w-[300px] origin-top rounded-[12px]" style={RAIL}>
            <div className="flex flex-col gap-2 p-1.5">
              {elements.map((e) => (
                <div key={e.name} className="flex flex-col">
                  <span className="flex items-center gap-1.5 px-2 py-0.5">
                    <span className={cn(MONO, "min-w-0 truncate text-[11px] text-white/40")}>{e.name}</span>
                  </span>
                  {e.changes.map((c) => (
                    <div key={c.label} className="flex h-7 items-center gap-2 rounded-md px-2">
                      <span className="shrink-0 text-[12.5px] font-medium text-white/75">{c.label}</span>
                      <span className={cn(MONO, "min-w-0 flex-1 truncate text-right text-[11.5px] text-white/45")}>
                        {c.from} → <span className="text-white/85">{c.to}</span>
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {applying && (
        <div className="flex h-9 items-center gap-2.5 rounded-[10px] pr-3 pl-3 text-[12.5px] text-white/75" style={RAIL}>
          <Spin />
          <span className="whitespace-nowrap">
            The agent is applying {applying.n} {applying.n === 1 ? "change" : "changes"}
            {applying.els > 1 && <span className="text-white/45"> on {applying.els} elements</span>}…
          </span>
        </div>
      )}
    </div>
  )
}

export const CheckMark = () => <Check className="size-3" />
