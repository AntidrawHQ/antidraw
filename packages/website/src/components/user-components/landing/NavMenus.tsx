/**
 * The navbar's role menus (EssayNav), in several styles to choose from (LandingNavMenus compares
 * them). Each shows one role's use cases and calls `onPick(ci)` to jump to one:
 *
 *  - list       titles only, roomy, an arrow on hover
 *  - described  each title with the first sentence of its description
 *  - swatch     each case's card colour as a little thumbnail, title and one line
 *  - preview    the list on the left; the hovered case's video plays on the right
 *  - mega       a full-width panel: the role's pitch on the left, its cases as cards on the right,
 *               each its real video held on its still frame, playing while hovered
 *  - editorial  big numbered titles, no chrome but the panel
 *  - chips      the pitch, then the cases as pills
 */
import { memo, useCallback, useRef, useState } from "react"
import { motion } from "motion/react"
import { ArrowRight, ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, USE_CASE_ROLES, cardSwatch } from "./UseCases"
import { ScenePlayback } from "../motion/canvas-ai/kit"

export type MenuStyle = "list" | "described" | "swatch" | "preview" | "mega" | "editorial" | "chips"

export const MENU_STYLES: { id: MenuStyle; name: string; note: string }[] = [
  { id: "list", name: "Simple list", note: "Titles only, roomy, an arrow on hover." },
  { id: "described", name: "Described", note: "Each title with its first sentence underneath." },
  { id: "swatch", name: "Swatch thumbnails", note: "Each case's card colour as a little thumbnail, so the menu matches the rows." },
  { id: "preview", name: "Live preview", note: "Hover a case and its video plays beside the list." },
  { id: "mega", name: "Mega panel", note: "Full width: the role's pitch on the left, its cases as cards on the right." },
  { id: "editorial", name: "Editorial", note: "Big numbered titles, in the landing's own voice." },
  { id: "chips", name: "Pitch and pills", note: "The role's pitch, then its cases as pills. The most compact." },
]

/** Wide styles span the navbar instead of hanging under their link. */
export const WIDE: Record<MenuStyle, boolean> = { list: false, described: false, swatch: false, preview: false, mega: true, editorial: false, chips: false }

const TONE = {
  dark: {
    panel: "bg-[#2c2c2c] ring-white/[0.08] shadow-[0_18px_44px_-18px_rgba(0,0,0,0.6)]",
    item: "hover:bg-white/[0.06]",
    on: "bg-white/[0.06]",
    ink: "text-white",
    soft: "text-white/60",
    quiet: "text-white/40",
    line: "border-white/[0.07]",
    pill: "bg-white/[0.06] hover:bg-white/[0.12] text-white",
  },
  light: {
    panel: "bg-white ring-black/[0.06] shadow-[0_18px_44px_-18px_rgba(0,0,0,0.22)]",
    item: "hover:bg-black/[0.04]",
    on: "bg-black/[0.04]",
    ink: "text-[#171717]",
    soft: "text-black/60",
    quiet: "text-black/40",
    line: "border-black/[0.06]",
    pill: "bg-black/[0.045] hover:bg-black/[0.08] text-[#171717]",
  },
}

const firstSentence = (s: string) => s.split(/(?<=\.)\s/)[0]

/** A case's card colour, as a small tile with the dark window inside. */
function Thumb({ ri, ci, className }: { ri: number; ci: number; className?: string }) {
  const [bg, ink] = cardSwatch(ri, ci)
  return (
    <span className={cn("relative block shrink-0 overflow-hidden", className)} style={{ background: bg }}>
      <span className="absolute inset-0 opacity-70" style={{ backgroundImage: `radial-gradient(${ink} 1px, transparent 1.4px)`, backgroundSize: "6px 6px" }} />
      <span className="absolute inset-[14%] bg-[#262626] shadow-[0_2px_6px_-2px_rgba(0,0,0,0.4)]" />
    </span>
  )
}

export function RoleMenu({ ri, style, theme, onPick, onRole }: { ri: number; style: MenuStyle; theme: "dark" | "light"; onPick: (ci: number) => void; onRole: () => void }) {
  const t = TONE[theme]
  const r = USE_CASE_ROLES[ri]
  const [hover, setHover] = useState(style === "mega" ? -1 : 0)

  if (style === "list")
    return (
      <div className={cn("w-[300px] rounded-2xl p-1.5 ring-1", t.panel)}>
        {r.cases.map((uc, ci) => (
          <button key={uc.title} type="button" onClick={() => onPick(ci)} className={cn("group flex w-full items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left transition-colors", t.item)}>
            <span className={cn("text-[15px] font-medium", t.ink)}>{uc.title}</span>
            <ArrowRight className={cn("size-4 shrink-0 -translate-x-1 opacity-0 transition-[opacity,translate] duration-200 group-hover:translate-x-0 group-hover:opacity-100", t.soft)} />
          </button>
        ))}
      </div>
    )

  if (style === "described")
    return (
      <div className={cn("w-[400px] rounded-2xl p-1.5 ring-1", t.panel)}>
        {r.cases.map((uc, ci) => (
          <button key={uc.title} type="button" onClick={() => onPick(ci)} className={cn("block w-full rounded-xl px-3.5 py-3 text-left transition-colors", t.item)}>
            <span className={cn("block text-[15px] font-medium", t.ink)}>{uc.title}</span>
            <span className={cn("mt-1 block text-[13.5px] leading-[1.45] text-pretty", t.soft)}>{firstSentence(uc.line)}</span>
          </button>
        ))}
      </div>
    )

  if (style === "swatch")
    return (
      <div className={cn("w-[420px] rounded-2xl p-1.5 ring-1", t.panel)}>
        {r.cases.map((uc, ci) => (
          <button key={uc.title} type="button" onClick={() => onPick(ci)} className={cn("flex w-full items-center gap-3.5 rounded-xl p-2.5 text-left transition-colors", t.item)}>
            <Thumb ri={ri} ci={ci} className="h-[46px] w-[72px]" />
            <span className="min-w-0">
              <span className={cn("block text-[15px] font-medium", t.ink)}>{uc.title}</span>
              <span className={cn("mt-0.5 block truncate text-[13px]", t.soft)}>{firstSentence(uc.line)}</span>
            </span>
          </button>
        ))}
      </div>
    )

  if (style === "preview")
    return (
      <div className={cn("flex w-[760px] gap-2 rounded-2xl p-2 ring-1", t.panel)}>
        <div className="flex w-[260px] shrink-0 flex-col">
          {r.cases.map((uc, ci) => (
            <button
              key={uc.title}
              type="button"
              onMouseEnter={() => setHover(ci)}
              onFocus={() => setHover(ci)}
              onClick={() => onPick(ci)}
              className={cn("rounded-xl px-3.5 py-3 text-left transition-colors", hover === ci ? t.on : t.item)}
            >
              <span className={cn("block text-[15px] font-medium", hover === ci ? t.ink : t.soft)}>{uc.title}</span>
            </button>
          ))}
          <button type="button" onClick={onRole} className={cn("mt-auto flex items-center gap-1.5 px-3.5 pt-3 pb-2 text-left text-[13.5px]", t.quiet)}>
            All {r.role} use cases <ArrowRight className="size-3.5" />
          </button>
        </div>
        <div className="min-w-0 flex-1 overflow-hidden rounded-xl">
          {/* Only the hovered case's video is mounted. */}
          <Card key={hover} uc={r.cases[hover]} role={r.role} ri={ri} ci={hover} />
        </div>
      </div>
    )

  if (style === "mega") return <MegaMenu open={ri} theme={theme} onPick={onPick} onRole={onRole} />

  if (style === "editorial")
    return (
      <div className={cn("w-[460px] rounded-2xl px-7 pt-6 pb-4 ring-1", t.panel)}>
        <div className={cn("text-[12px] font-medium tracking-[0.1em] uppercase", t.quiet)}>For {r.role}</div>
        <div className="mt-3">
          {r.cases.map((uc, ci) => (
            <button key={uc.title} type="button" onClick={() => onPick(ci)} className={cn("group flex w-full items-baseline gap-4 border-t py-3.5 text-left first:border-t-0", t.line)}>
              <span className={cn("w-6 shrink-0 text-[13px] tabular-nums", t.quiet)}>{String(ci + 1).padStart(2, "0")}</span>
              <span className={cn("flex-1 text-[21px] leading-[1.2] font-medium tracking-[-0.018em] transition-colors", t.ink)}>{uc.title}</span>
              <ArrowUpRight className={cn("size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100", t.soft)} />
            </button>
          ))}
        </div>
      </div>
    )

  return (
    <div className={cn("w-[420px] rounded-2xl p-5 ring-1", t.panel)}>
      <p className={cn("m-0 text-[15px] leading-[1.5] text-pretty", t.soft)}>{r.pitch}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {r.cases.map((uc, ci) => (
          <button key={uc.title} type="button" onClick={() => onPick(ci)} className={cn("rounded-full px-3.5 py-2 text-[14px] font-medium transition-colors", t.pill)}>
            {uc.title}
          </button>
        ))}
      </div>
    </div>
  )
}

/** One role's side of the mega panel: its pitch, then its cases as cards whose videos play while hovered. Memoised, so switching roles doesn't re-render its scenes. */
const MegaRole = memo(function MegaRole({ ri, theme, onPick, onRole }: { ri: number; theme: "dark" | "light"; onPick: (ci: number, ri: number) => void; onRole: (ri: number) => void }) {
  const t = TONE[theme]
  const r = USE_CASE_ROLES[ri]
  const [hover, setHover] = useState(-1)
  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-10 p-8">
      <div>
        <div className={cn("text-[24px] font-medium tracking-[-0.02em]", t.ink)}>For {r.role}</div>
        <p className={cn("m-0 mt-3 text-[15px] leading-[1.5] text-pretty", t.soft)}>{r.pitch}</p>
        <button type="button" onClick={() => onRole(ri)} className={cn("mt-6 inline-flex items-center gap-1.5 text-[14px] font-medium", t.ink)}>
          See them all <ArrowRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4">
        {r.cases.map((uc, ci) => (
          // A div, not a button: the video inside has buttons of its own.
          <div
            key={uc.title}
            role="link"
            tabIndex={0}
            onClick={() => onPick(ci, ri)}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(ci, ri))}
            onMouseEnter={() => setHover(ci)}
            onFocus={() => setHover(ci)}
            onMouseLeave={() => setHover(-1)}
            className="group cursor-pointer self-start text-left"
          >
            {/* The row's own card: its video held on the still frame, playing while hovered. */}
            <span className="block transition-transform duration-300 group-hover:-translate-y-0.5">
              <ScenePlayback.Provider value={hover === ci ? "live" : "still"}>
                <Card uc={uc} role={r.role} ri={ri} ci={ci} />
              </ScenePlayback.Provider>
            </span>
            <span className={cn("mt-3 block text-[15px] font-medium", t.ink)}>{uc.title}</span>
            <span className={cn("mt-1 block text-[13px] leading-[1.45] text-pretty", t.soft)}>{firstSentence(uc.line)}</span>
          </div>
        ))}
      </div>
    </div>
  )
})

/**
 * The mega panel with every role in it at once, stacked in one cell: switching roles only fades
 * between them, so no card has to mount (and stall a frame) mid-switch. The roles left of the open
 * one wait a little to the left, those right of it to the right, so each slides in the way the
 * pointer went. `open` -1 shows none (the navbar fades the whole panel out). `instant`: the open one
 * just shows, no fade or slide.
 */
export function MegaMenu({ open, theme, onPick, onRole, instant = false }: { open: number; theme: "dark" | "light"; onPick: (ci: number, ri: number) => void; onRole: (ri: number) => void; instant?: boolean }) {
  const t = TONE[theme]
  // Stable handlers for the memoised roles; they call whatever the navbar passed last.
  const latest = useRef({ onPick, onRole })
  latest.current = { onPick, onRole }
  const pick = useCallback((ci: number, ri: number) => latest.current.onPick(ci, ri), [])
  const role = useCallback((ri: number) => latest.current.onRole(ri), [])
  return (
    <div className={cn("grid overflow-hidden rounded-2xl ring-1", t.panel)}>
      {USE_CASE_ROLES.map((r, ri) => {
        const on = ri === open
        if (instant)
          return (
            <div key={r.role} className={cn("[grid-area:1/1]", !on && "pointer-events-none invisible opacity-0")} aria-hidden={!on}>
              <MegaRole ri={ri} theme={theme} onPick={pick} onRole={role} />
            </div>
          )
        return (
          <motion.div
            key={r.role}
            initial={false}
            animate={{ opacity: on ? 1 : 0, x: on ? 0 : ri < open ? -18 : 18 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={cn("[grid-area:1/1]", !on && "pointer-events-none")}
            aria-hidden={!on}
          >
            <MegaRole ri={ri} theme={theme} onPick={pick} onRole={role} />
          </motion.div>
        )
      })}
    </div>
  )
}
