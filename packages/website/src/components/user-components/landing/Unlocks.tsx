/**
 * "Bring any library, make anything": what a library unlocks on the canvas (Motion for
 * micro-interactions, Remotion for videos …), in four layouts to choose from (LandingUnlocks
 * compares them). Each pair has a small looping preview of what it makes, drawn in plain SVG and
 * CSS so the section stays light; the loops pause while the section is offscreen.
 *
 *  - sentences  big editorial lines, "use Motion to build micro-interactions", each with its preview at the end
 *  - cards      a grid of recipe cards, each its preview over "Motion → micro-interactions"
 *  - ticker     one big sentence that cycles through the pairs, its preview beside it
 *  - tabs       the outcomes as a list on the left, the chosen one's preview large on the right
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { ArrowRight, ChevronLeft, ChevronRight, Package, Plus } from "lucide-react"

import { cn } from "@/lib/utils"
import { BigMark, OPEN_LIBS, type Lib } from "../libraries/catalog"
import { useType } from "./TypeScale"

export type UnlockStyle = "sentences" | "cards" | "ticker" | "tabs"

export const UNLOCK_STYLES: { id: UnlockStyle; name: string; note: string }[] = [
  { id: "sentences", name: "Sentences", note: "Big editorial lines in the essay's voice, each with its preview playing at the end." },
  { id: "cards", name: "Recipe cards", note: "A grid of cards, each a live preview over library → outcome." },
  { id: "ticker", name: "Ticker", note: "One big sentence that cycles through the pairs, with its preview beside it." },
  { id: "tabs", name: "List and preview", note: "The outcomes as a list, the chosen one's preview large beside it; steps through on its own." },
]

export type Kind = "micro" | "video" | "dashboard" | "charts" | "three" | "voice" | "landing"

const lib = (name: string) => OPEN_LIBS.find((l) => l.library === name) as Lib

export const UNLOCKS: { lib: Lib; verb: string; outcome: string; line: string; kind: Kind }[] = [
  { lib: lib("Motion"), verb: "build", outcome: "micro-interactions", line: "Toggles, hovers and transitions that feel right, tuned on the canvas.", kind: "micro" },
  { lib: lib("Remotion"), verb: "make", outcome: "product videos", line: "Launch videos written as code, scene by scene, played right in the frame.", kind: "video" },
  { lib: lib("shadcn/ui"), verb: "build", outcome: "SaaS dashboards", line: "Sidebars, tables and settings pages with real components.", kind: "dashboard" },
  { lib: lib("Recharts"), verb: "draw", outcome: "charts", line: "Charts from real numbers, not placeholder bars.", kind: "charts" },
  { lib: lib("React Three Fiber"), verb: "build", outcome: "3D scenes", line: "Product viewers and scenes you can spin, right in the frame.", kind: "three" },
  { lib: lib("ElevenLabs UI"), verb: "design", outcome: "voice agents", line: "Orbs, waveforms and transcripts for things that talk.", kind: "voice" },
  { lib: lib("Magic UI"), verb: "make", outcome: "landing pages", line: "Heroes, marquees and reveals for your next launch.", kind: "landing" },
]

/* ── Tones ────────────────────────────────────────────────────────────── */

export const TONE = {
  dark: {
    ink: "text-white",
    soft: "text-white/70",
    quiet: "text-white/40",
    line: "border-white/[0.07]",
    card: "bg-white/[0.03] ring-white/[0.07]",
    on: "bg-white/[0.06]",
    hover: "hover:bg-white/[0.04]",
    dash: "border-white/15",
  },
  light: {
    ink: "text-[#171717]",
    soft: "text-black/60",
    quiet: "text-black/40",
    line: "border-black/[0.07]",
    card: "bg-white ring-black/[0.06]",
    on: "bg-black/[0.045]",
    hover: "hover:bg-black/[0.03]",
    dash: "border-black/15",
  },
}

/** The previews' colours: a surface, panels on it, hairlines, ink and the page's Dusk accents. */
const INK = {
  dark: { bg: "#2c2c2c", panel: "#363636", line: "rgba(255,255,255,0.09)", ink: "rgba(255,255,255,0.82)", mute: "rgba(255,255,255,0.18)" },
  light: { bg: "#ffffff", panel: "#f1f1ef", line: "rgba(0,0,0,0.07)", ink: "#262626", mute: "rgba(0,0,0,0.12)" },
}
const A = { indigo: "#4b4fa8", violet: "#7c6cd6", rose: "#c47aa8", coral: "#d97757", peach: "#f4d6c4" }

/** The section's headline, shared by every layout. */
const TITLE = ["bring any library to the canvas.", "make and iterate on anything."]
const PARA = "There's no list of supported libraries. If it's on npm, your agent installs it and builds with it, right on the canvas."

/* ── Previews ─────────────────────────────────────────────────────────── */

export const KEYFRAMES = `
.ul-root[data-off] * { animation-play-state: paused !important; }
.ul-root svg * { transform-box: fill-box; }
@keyframes ul-knob { 0%,38% { transform: translateX(0) } 48%,88% { transform: translateX(26px) } 98%,100% { transform: translateX(0) } }
@keyframes ul-fill { 0%,38% { opacity: 0 } 48%,88% { opacity: 1 } 98%,100% { opacity: 0 } }
@keyframes ul-pop { 0%,52% { transform: scale(1) } 58% { transform: scale(1.32) } 64% { transform: scale(.92) } 70%,100% { transform: scale(1) } }
@keyframes ul-heart { 0%,55% { opacity: 0 } 58%,92% { opacity: 1 } 100% { opacity: 0 } }
@keyframes ul-ring { 0%,55% { transform: scale(.6); opacity: 0 } 58% { opacity: .7 } 75%,100% { transform: scale(1.7); opacity: 0 } }
@keyframes ul-press { 0%,18% { transform: scale(1) } 22% { transform: scale(.94) } 28%,100% { transform: scale(1) } }
@keyframes ul-play { from { transform: translateX(0) } to { transform: translateX(196px) } }
@keyframes ul-slide { 0%,8% { transform: translateX(-14px); opacity: 0 } 18%,80% { transform: translateX(0); opacity: 1 } 90%,100% { transform: translateX(10px); opacity: 0 } }
@keyframes ul-draw { 0%,10% { stroke-dashoffset: 1 } 55%,90% { stroke-dashoffset: 0 } 100% { stroke-dashoffset: 0; opacity: 0 } }
@keyframes ul-grow { 0%,6% { transform: scaleY(0) } 30%,88% { transform: scaleY(1) } 100% { transform: scaleY(0) } }
@keyframes ul-spin { from { transform: rotateX(-24deg) rotateY(0) } to { transform: rotateX(-24deg) rotateY(360deg) } }
@keyframes ul-wave { 0%,100% { transform: scaleY(.25) } 50% { transform: scaleY(1) } }
@keyframes ul-breathe { 0%,100% { transform: scale(.94) } 50% { transform: scale(1.04) } }
@keyframes ul-pulse { 0% { transform: scale(.8); opacity: .5 } 100% { transform: scale(1.6); opacity: 0 } }
@keyframes ul-in { 0%,4% { transform: translateY(6px); opacity: 0 } 14%,86% { transform: translateY(0); opacity: 1 } 96%,100% { opacity: 0 } }
@keyframes ul-row { 0%,10% { opacity: .35 } 20%,30% { opacity: 1 } 40%,100% { opacity: .35 } }
`

const anim = (name: string, s: number, delay = 0, extra = "") => ({ animation: `${name} ${s}s ${extra || "cubic-bezier(.3,.7,.3,1)"} ${delay}s infinite` })

function Micro({ c }: { c: (typeof INK)["dark"] }) {
  return (
    <svg viewBox="0 0 240 160" className="size-full">
      {/* A switch that slides on. */}
      <rect x="34" y="40" width="64" height="34" rx="17" fill={c.mute} />
      <rect x="34" y="40" width="64" height="34" rx="17" fill={A.violet} style={anim("ul-fill", 3.6)} />
      <circle cx="51" cy="57" r="13" fill="#fff" style={anim("ul-knob", 3.6, 0, "cubic-bezier(.5,1.6,.4,1)")} />
      {/* A like that pops, with a ring. */}
      <circle cx="170" cy="57" r="22" fill="none" stroke={A.coral} strokeWidth="2" style={anim("ul-ring", 3.6)} />
      <g style={anim("ul-pop", 3.6)}>
        <path d="M170 68 l-11-11 a7 7 0 0 1 11-9 a7 7 0 0 1 11 9 z" fill="none" stroke={c.ink} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M170 68 l-11-11 a7 7 0 0 1 11-9 a7 7 0 0 1 11 9 z" fill={A.coral} stroke={A.coral} strokeWidth="2.2" strokeLinejoin="round" style={anim("ul-heart", 3.6)} />
      </g>
      {/* A button that presses. */}
      <g style={anim("ul-press", 3.6)}>
        <rect x="64" y="104" width="112" height="34" rx="10" fill={c.ink} />
        <rect x="96" y="118" width="48" height="6" rx="3" fill={c.bg} />
      </g>
    </svg>
  )
}

function Video({ c }: { c: (typeof INK)["dark"] }) {
  const clips = [
    [22, 44, A.indigo],
    [68, 58, A.violet],
    [128, 40, A.rose],
    [170, 48, A.coral],
  ] as const
  // Unique per preview: several can be on the page at once.
  const id = useId()
  return (
    <svg viewBox="0 0 240 160" className="size-full">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={A.indigo} />
          <stop offset=".6" stopColor={A.violet} />
          <stop offset="1" stopColor={A.coral} />
        </linearGradient>
      </defs>
      <rect x="20" y="14" width="200" height="98" rx="8" fill={`url(#${id})`} />
      <rect x="38" y="44" width="96" height="12" rx="3" fill="#fff" style={anim("ul-slide", 4)} />
      <rect x="38" y="62" width="64" height="8" rx="3" fill="rgba(255,255,255,.6)" style={anim("ul-slide", 4, 0.15)} />
      <circle cx="186" cy="80" r="14" fill="rgba(255,255,255,.18)" style={anim("ul-breathe", 4)} />
      {/* The timeline, clips and a playhead. */}
      <rect x="20" y="124" width="200" height="22" rx="5" fill={c.panel} />
      {clips.map(([x, w, f]) => (
        <rect key={x} x={x} y="128" width={w} height="14" rx="3" fill={f} opacity=".85" />
      ))}
      <g style={anim("ul-play", 4, 0, "linear")}>
        <rect x="21" y="118" width="2" height="32" rx="1" fill={c.ink} />
        <circle cx="22" cy="118" r="3.5" fill={c.ink} />
      </g>
    </svg>
  )
}

function Dashboard({ c }: { c: (typeof INK)["dark"] }) {
  return (
    <svg viewBox="0 0 240 160" className="size-full">
      <rect x="10" y="10" width="220" height="140" rx="8" fill={c.panel} />
      {/* Sidebar. */}
      <rect x="10" y="10" width="50" height="140" rx="8" fill={c.bg} />
      <rect x="20" y="22" width="16" height="16" rx="4" fill={c.ink} />
      {[52, 66, 80, 94].map((y, i) => (
        <rect key={y} x="20" y={y} width={i === 0 ? 30 : 24} height="6" rx="3" fill={i === 0 ? c.ink : c.mute} />
      ))}
      {/* KPIs. */}
      {[70, 124, 178].map((x, i) => (
        <g key={x}>
          <rect x={x} y="20" width="44" height="34" rx="5" fill={c.bg} />
          <rect x={x + 7} y="28" width="20" height="4" rx="2" fill={c.mute} />
          <rect x={x + 7} y="38" width={[26, 20, 30][i]} height="8" rx="2" fill={c.ink} />
        </g>
      ))}
      {/* A sparkline that draws. */}
      <rect x="70" y="62" width="152" height="44" rx="5" fill={c.bg} />
      <path d="M78 96 L98 88 L116 92 L134 76 L152 82 L172 70 L192 74 L214 66" fill="none" stroke={A.violet} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" style={anim("ul-draw", 4.5)} />
      {/* Table rows, one lit at a time. */}
      {[114, 126, 138].map((y, i) => (
        <g key={y} style={anim("ul-row", 4.5, i * 0.6)}>
          <rect x="70" y={y} width="10" height="6" rx="3" fill={[A.coral, A.violet, A.rose][i]} />
          <rect x="86" y={y} width="58" height="6" rx="3" fill={c.mute} />
          <rect x="190" y={y} width="30" height="6" rx="3" fill={c.mute} />
        </g>
      ))}
    </svg>
  )
}

function Charts({ c }: { c: (typeof INK)["dark"] }) {
  const bars = [40, 62, 50, 84, 70, 98, 88]
  const fills = [A.indigo, A.indigo, A.violet, A.violet, A.rose, A.coral, A.coral]
  return (
    <svg viewBox="0 0 240 160" className="size-full">
      {[34, 64, 94, 124].map((y) => (
        <line key={y} x1="24" x2="220" y1={y} y2={y} stroke={c.line} />
      ))}
      {bars.map((h, i) => (
        <rect key={i} x={32 + i * 27} y={128 - h} width="18" height={h} rx="3" fill={fills[i]} style={{ ...anim("ul-grow", 4.2, i * 0.07), transformOrigin: "bottom" }} />
      ))}
      <path d="M41 96 L68 78 L95 86 L122 56 L149 66 L176 40 L203 46" fill="none" stroke={c.ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray="1 1" style={anim("ul-draw", 4.2, 0.3)} />
      <line x1="24" x2="220" y1="128" y2="128" stroke={c.ink} strokeOpacity=".4" />
    </svg>
  )
}

function Three({ c }: { c: (typeof INK)["dark"] }) {
  const s = 56
  const faces = [
    `rotateY(0deg) translateZ(${s / 2}px)`,
    `rotateY(90deg) translateZ(${s / 2}px)`,
    `rotateY(180deg) translateZ(${s / 2}px)`,
    `rotateY(-90deg) translateZ(${s / 2}px)`,
    `rotateX(90deg) translateZ(${s / 2}px)`,
    `rotateX(-90deg) translateZ(${s / 2}px)`,
  ]
  const tint = [A.indigo, A.violet, A.rose, A.coral, A.peach, A.indigo]
  return (
    <div className="relative grid size-full place-items-center" style={{ perspective: 420 }}>
      {/* A floor grid, and the cube spinning above its shadow. */}
      <svg viewBox="0 0 240 160" className="absolute inset-0 size-full">
        <ellipse cx="120" cy="124" rx="44" ry="8" fill={c.mute} />
      </svg>
      <div className="relative -mt-4" style={{ width: s, height: s, transformStyle: "preserve-3d", ...anim("ul-spin", 9, 0, "linear") }}>
        {faces.map((f, i) => (
          <div key={i} className="absolute inset-0 rounded-[6px]" style={{ transform: f, background: tint[i], opacity: 0.9, boxShadow: `inset 0 0 0 1px ${c.line}` }} />
        ))}
      </div>
    </div>
  )
}

function Voice({ c }: { c: (typeof INK)["dark"] }) {
  const bars = Array.from({ length: 15 }, (_, i) => i)
  const id = useId()
  return (
    <svg viewBox="0 0 240 160" className="size-full">
      <defs>
        <radialGradient id={id} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor={A.peach} />
          <stop offset=".45" stopColor={A.rose} />
          <stop offset="1" stopColor={A.indigo} />
        </radialGradient>
      </defs>
      <circle cx="120" cy="62" r="30" fill="none" stroke={A.violet} strokeWidth="1.5" style={{ ...anim("ul-pulse", 2.4, 0, "ease-out"), transformOrigin: "center" }} />
      <circle cx="120" cy="62" r="30" fill="none" stroke={A.violet} strokeWidth="1.5" style={{ ...anim("ul-pulse", 2.4, 1.2, "ease-out"), transformOrigin: "center" }} />
      <circle cx="120" cy="62" r="30" fill={`url(#${id})`} style={{ ...anim("ul-breathe", 2.4, 0, "ease-in-out"), transformOrigin: "center" }} />
      {bars.map((i) => (
        <rect
          key={i}
          x={64 + i * 8}
          y="112"
          width="4"
          height="28"
          rx="2"
          fill={c.ink}
          opacity={0.35 + 0.65 * Math.sin((i / 14) * Math.PI)}
          style={{ ...anim("ul-wave", 0.9 + (i % 4) * 0.18, i * 0.06, "ease-in-out"), transformOrigin: "center" }}
        />
      ))}
    </svg>
  )
}

function Landing({ c }: { c: (typeof INK)["dark"] }) {
  return (
    <svg viewBox="0 0 240 160" className="size-full">
      <rect x="16" y="10" width="208" height="140" rx="8" fill={c.panel} />
      <rect x="28" y="20" width="22" height="6" rx="3" fill={c.ink} />
      {[150, 170, 190].map((x) => (
        <rect key={x} x={x} y="21" width="14" height="4" rx="2" fill={c.mute} />
      ))}
      <g style={anim("ul-in", 5)}>
        <rect x="64" y="40" width="112" height="10" rx="3" fill={c.ink} />
        <rect x="80" y="54" width="80" height="10" rx="3" fill={c.ink} />
      </g>
      <rect x="84" y="70" width="72" height="5" rx="2.5" fill={c.mute} style={anim("ul-in", 5, 0.2)} />
      <rect x="98" y="82" width="44" height="13" rx="6.5" fill={A.coral} style={anim("ul-in", 5, 0.35)} />
      {[28, 94, 160].map((x, i) => (
        <rect key={x} x={x} y="106" width="52" height="34" rx="5" fill={[A.indigo, A.violet, A.rose][i]} opacity=".85" style={anim("ul-in", 5, 0.5 + i * 0.12)} />
      ))}
    </svg>
  )
}

const PREVIEWS: Record<Kind, (p: { c: (typeof INK)["dark"] }) => ReactNode> = { micro: Micro, video: Video, dashboard: Dashboard, charts: Charts, three: Three, voice: Voice, landing: Landing }

export function Preview({ kind, theme, className }: { kind: Kind; theme: "dark" | "light"; className?: string }) {
  const c = INK[theme]
  const P = PREVIEWS[kind]
  return (
    <div className={cn("overflow-hidden", className)} style={{ background: c.bg }}>
      <P c={c} />
    </div>
  )
}

/* ── Shared bits ──────────────────────────────────────────────────────── */

/** Pauses the loops while the section is offscreen, and says whether it's on screen. */
export function useOnScreen() {
  const ref = useRef<HTMLElement>(null)
  const [on, setOn] = useState(true)
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting))
    io.observe(ref.current!)
    return () => io.disconnect()
  }, [])
  return [ref, on] as const
}

export function Heading({ theme, center }: { theme: "dark" | "light"; center?: boolean }) {
  const t = TONE[theme]
  const ty = useType()
  return (
    <div className={cn(center && "flex flex-col items-center text-center")}>
      <h2 className={cn("font-medium", ty.h2, t.ink)} style={{ fontVariationSettings: '"opsz" 32' }}>
        {TITLE[0]}{" "}
        <br className="max-sm:hidden" />
        {TITLE[1]}
      </h2>
      <p className={cn("max-w-[620px] text-pretty", ty.para, t.soft)}>{PARA}</p>
    </div>
  )
}

/** npm's own red, for the "anything else" item. */
export const NpmMark = ({ size = 40 }: { size?: number }) => (
  <span className="grid shrink-0 place-items-center bg-[#cb3837] text-white" style={{ width: size, height: size, borderRadius: size / 4 }}>
    <Package style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
  </span>
)

/* ── Layouts ──────────────────────────────────────────────────────────── */

function Sentences({ theme }: { theme: "dark" | "light" }) {
  const t = TONE[theme]
  const [hover, setHover] = useState(0)
  return (
    <div>
      <Heading theme={theme} />
      {/* Every line with its own preview at the end, all playing at once; the hovered line is the one in full ink. */}
      <ul className={cn("mt-14 border-t", t.line)}>
        {UNLOCKS.map((u, i) => (
          <li key={u.outcome} onMouseEnter={() => setHover(i)} className={cn("grid grid-cols-[40px_minmax(0,1fr)] items-center gap-5 border-b py-5 sm:grid-cols-[40px_minmax(0,1fr)_192px] sm:gap-6", t.line)}>
            <BigMark mark={u.lib.mark} size={40} />
            <span className={cn("text-[22px] leading-[1.3] tracking-[-0.018em] transition-colors sm:text-[28px]", hover === i ? t.ink : t.quiet)}>
              use <span className={cn("font-medium", hover === i ? t.ink : t.soft)}>{u.lib.library}</span> to {u.verb} <span className={cn("font-medium", hover === i ? t.ink : t.soft)}>{u.outcome}</span>
            </span>
            <Preview kind={u.kind} theme={theme} className={cn("hidden aspect-[3/2] w-full rounded-xl ring-1 sm:block", t.card)} />
          </li>
        ))}
        <li className={cn("grid grid-cols-[40px_minmax(0,1fr)] items-center gap-5 border-b py-5 sm:grid-cols-[40px_minmax(0,1fr)_192px] sm:gap-6", t.line)}>
          <NpmMark />
          <span className={cn("text-[22px] leading-[1.3] tracking-[-0.018em] sm:text-[28px]", t.quiet)}>
            or <span className={cn("font-medium", t.soft)}>anything else on npm</span>, to make <span className={cn("font-medium", t.soft)}>whatever you want</span>
          </span>
          {/* An empty frame: yours to fill. */}
          <span className={cn("hidden aspect-[3/2] w-full place-items-center rounded-xl border border-dashed sm:grid", t.dash, t.quiet)}>
            <Plus className="size-5" />
          </span>
        </li>
      </ul>
    </div>
  )
}

function Cards({ theme }: { theme: "dark" | "light" }) {
  const t = TONE[theme]
  return (
    <div>
      <Heading theme={theme} />
      <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {UNLOCKS.map((u) => (
          <div key={u.outcome} className={cn("overflow-hidden rounded-2xl ring-1", t.card)}>
            <Preview kind={u.kind} theme={theme} className="aspect-[3/2] w-full" />
            <div className="p-5">
              <div className="flex items-center gap-2.5">
                <BigMark mark={u.lib.mark} size={24} radius={6} />
                <span className={cn("text-[14px] font-medium", t.soft)}>{u.lib.library}</span>
                <ArrowRight className={cn("size-3.5", t.quiet)} />
              </div>
              <div className={cn("mt-3 text-[20px] leading-[1.2] font-medium tracking-[-0.018em]", t.ink)}>{u.outcome[0].toUpperCase() + u.outcome.slice(1)}</div>
              <p className={cn("mt-1.5 text-[14px] leading-[1.45] text-pretty", t.soft)}>{u.line}</p>
            </div>
          </div>
        ))}
        {/* The last card is the point: the list never ends. */}
        <div className={cn("flex flex-col justify-end rounded-2xl border border-dashed p-5", t.dash)}>
          <NpmMark size={24} />
          <div className={cn("mt-3 text-[20px] leading-[1.2] font-medium tracking-[-0.018em]", t.ink)}>Anything else</div>
          <p className={cn("mt-1.5 text-[14px] leading-[1.45] text-pretty", t.soft)}>Any library on npm. Ask for it and it's on the canvas.</p>
        </div>
      </div>
    </div>
  )
}

export function Ticker({ theme, on }: { theme: "dark" | "light"; on: boolean }) {
  const t = TONE[theme]
  const ty = useType()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!on) return
    // Keyed on i too, so stepping by hand gives the new one its full 3.2s.
    const id = setInterval(() => setI((n) => (n + 1) % UNLOCKS.length), 3200)
    return () => clearInterval(id)
  }, [on, i])
  const u = UNLOCKS[i]
  const step = (d: number) => setI((n) => (n + d + UNLOCKS.length) % UNLOCKS.length)
  const arrow = cn("grid size-8 place-items-center rounded-full ring-1 transition-colors", theme === "dark" ? "text-white/60 ring-white/15 hover:bg-white/10 hover:text-white" : "text-black/50 ring-black/10 hover:bg-black/5 hover:text-black")
  return (
    <div>
      <Heading theme={theme} center />
      <div className="mx-auto mt-14 grid max-w-[880px] items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cn("font-medium tracking-[-0.03em]", ty.ticker, "leading-[1.15]", t.quiet)}>
          use
          <br />
          {/* key restarts the fade-up on each change. */}
          <span key={`l${i}`} className={cn("inline-flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500", t.ink)}>
            <BigMark mark={u.lib.mark} size={ty.tickerMark} radius={ty.tickerMark / 4} />
            {u.lib.library}
          </span>
          <br />
          to {u.verb}
          <br />
          <span key={`o${i}`} className={cn("inline-block animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100 fill-mode-both", t.ink)}>
            {u.outcome}.
          </span>
        </div>
        <Preview key={i} kind={u.kind} theme={theme} className={cn("aspect-[3/2] w-full animate-in fade-in zoom-in-[0.98] rounded-2xl ring-1 duration-500", t.card)} />
      </div>
      {/* Every library as a dot to jump to, the current one lit. On a phone the dots give way to a count between the arrows. */}
      <div className="mt-10 flex flex-wrap items-center justify-center gap-1.5">
        <button type="button" aria-label="Previous" onClick={() => step(-1)} className={cn(arrow, "mr-2")}>
          <ChevronLeft className="size-4" />
        </button>
        {UNLOCKS.map((x, n) => (
          <button key={x.outcome} type="button" onClick={() => setI(n)} title={`${x.lib.library} → ${x.outcome}`} className={cn("hidden rounded-lg p-1 transition-opacity sm:block", n === i ? "opacity-100" : "opacity-35 hover:opacity-70")}>
            <BigMark mark={x.lib.mark} size={26} radius={7} />
          </button>
        ))}
        <span className={cn("w-14 text-center text-[14px] tabular-nums sm:hidden", t.quiet)}>
          {i + 1} / {UNLOCKS.length}
        </span>
        <button type="button" aria-label="Next" onClick={() => step(1)} className={cn(arrow, "ml-2")}>
          <ChevronRight className="size-4" />
        </button>
        <span className={cn("text-[14px] max-sm:mt-3 max-sm:w-full max-sm:text-center sm:ml-3", t.quiet)}>and anything else on npm</span>
      </div>
    </div>
  )
}

function Tabs({ theme, on }: { theme: "dark" | "light"; on: boolean }) {
  const t = TONE[theme]
  const [i, setI] = useState(0)
  const [held, setHeld] = useState(false)
  // Steps through on its own until someone picks one.
  useEffect(() => {
    if (!on || held) return
    const id = setInterval(() => setI((n) => (n + 1) % UNLOCKS.length), 4200)
    return () => clearInterval(id)
  }, [on, held])
  return (
    <div>
      <Heading theme={theme} />
      <div className="mt-16 grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="flex flex-col gap-1">
          {UNLOCKS.map((u, n) => (
            <button
              key={u.outcome}
              type="button"
              onClick={() => (setI(n), setHeld(true))}
              className={cn("relative flex items-center gap-4 overflow-hidden rounded-xl px-4 py-3.5 text-left transition-colors", n === i ? t.on : t.hover)}
            >
              <BigMark mark={u.lib.mark} size={32} radius={8} />
              <span className="min-w-0">
                <span className={cn("block text-[17px] font-medium tracking-[-0.012em]", n === i ? t.ink : t.soft)}>{u.outcome[0].toUpperCase() + u.outcome.slice(1)}</span>
                <span className={cn("block text-[13.5px]", t.quiet)}>with {u.lib.library}</span>
              </span>
              {/* How long until the next one. */}
              {n === i && !held && on && <span className="absolute bottom-0 left-4 h-[2px] origin-left rounded-full bg-current opacity-30" style={{ right: 16, animation: "ul-bar 4.2s linear" }} />}
            </button>
          ))}
          <div className={cn("flex items-center gap-4 px-4 py-3.5", t.quiet)}>
            <NpmMark size={32} />
            <span className="text-[15px]">or anything else on npm</span>
          </div>
        </div>
        <div>
          <Preview key={i} kind={UNLOCKS[i].kind} theme={theme} className={cn("aspect-[3/2] w-full animate-in fade-in rounded-2xl ring-1 duration-500", t.card)} />
          <p className={cn("mt-4 text-[17px] leading-[1.5] text-pretty", t.soft)}>{UNLOCKS[i].line}</p>
        </div>
      </div>
      <style>{`@keyframes ul-bar { from { transform: scaleX(0) } to { transform: scaleX(1) } }`}</style>
    </div>
  )
}

/** The section, in one of the four layouts. */
export function UnlocksSection({ style, theme = "dark", className }: { style: UnlockStyle; theme?: "dark" | "light"; className?: string }) {
  const [ref, on] = useOnScreen()
  return (
    <section ref={ref} data-off={on ? undefined : ""} className={cn("ul-root", className)}>
      <style>{KEYFRAMES}</style>
      {style === "sentences" ? <Sentences theme={theme} /> : style === "cards" ? <Cards theme={theme} /> : style === "ticker" ? <Ticker theme={theme} on={on} /> : <Tabs theme={theme} on={on} />}
    </section>
  )
}
