/**
 * Shared bits for the "Claude makes it" motion scenes (MotionPrototypes,
 * MotionPolish, MotionKits, MotionRoundTrip, MotionLocal): a scaled stage, a
 * rAF clock that pauses offscreen and freezes under reduced motion, timing and
 * easing helpers, and the small pieces of Antidraw's UI the scenes draw
 * (cursor, selection, frame label, Claude mark, app shell, inline composer).
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { ArrowUp } from "lucide-react"

import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ timing */

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))
/** 0→1 as t goes from a to b. */
export const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a))
export const mix = (a: number, b: number, p: number) => a + (b - a) * p
export const outCubic = (p: number) => 1 - (1 - p) ** 3
export const outQuint = (p: number) => 1 - (1 - p) ** 5
export const inOutCubic = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)
export const inOutQuint = (p: number) => (p < 0.5 ? 16 * p ** 5 : 1 - (-2 * p + 2) ** 5 / 2)
export const outBack = (p: number, s = 1.6) => 1 + (s + 1) * (p - 1) ** 3 + s * (p - 1) ** 2
/** A damped spring that settles by p = 1. */
export const spring = (p: number, bounce = 0.35) =>
  p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.exp(-6 * p) * Math.cos(p * Math.PI * (1.5 + bounce * 4))
/** Eased progress of a window. */
export const win = (t: number, a: number, b: number, ease: (p: number) => number = inOutCubic) => ease(seg(t, a, b))
/** How many characters of `text` are typed at time t, starting at a. */
export const typedAt = (t: number, a: number, cps = 26) => Math.max(0, Math.floor((t - a) * cps))
/** In then out: 0 → 1 over [a, a+fi], hold, 1 → 0 over [b-fo, b]. */
export const pulse = (t: number, a: number, b: number, fi = 0.3, fo = 0.3) =>
  Math.min(outCubic(seg(t, a, a + fi)), 1 - inOutCubic(seg(t, b - fo, b)))

type Pt = readonly [number, number]
/** A point on a quadratic curve from p0 to p1, bowed sideways by `bend` px. */
export function curve(p: number, p0: Pt, p1: Pt, bend = 60): [number, number] {
  const mx = (p0[0] + p1[0]) / 2
  const my = (p0[1] + p1[1]) / 2
  const dx = p1[0] - p0[0]
  const dy = p1[1] - p0[1]
  const len = Math.hypot(dx, dy) || 1
  const cx = mx + (-dy / len) * bend
  const cy = my + (dx / len) * bend
  const u = 1 - p
  return [u * u * p0[0] + 2 * u * p * cx + p * p * p1[0], u * u * p0[1] + 2 * u * p * cy + p * p * p1[1]]
}

/**
 * A cursor path through keyframes: [time, x, y]. Glides between them on gentle
 * curves with an ease-in-out.
 */
export function path(t: number, keys: readonly (readonly [number, number, number])[], bend = 40): [number, number] {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]]
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, xa, ya] = keys[i]
    const [tb, xb, yb] = keys[i + 1]
    if (t <= tb) return curve(inOutCubic(seg(t, ta, tb)), [xa, ya], [xb, yb], i % 2 ? -bend : bend)
  }
  const k = keys[keys.length - 1]
  return [k[1], k[2]]
}

/* ------------------------------------------------------------------- clock */

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/**
 * Seconds into a looping timeline of `duration`, ticking on rAF only while
 * the element is on screen. Under reduced motion it holds `still`.
 */
export function useSceneClock(duration: number, still: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [t, setT] = useState(() => (reduced() ? still : 0))
  useEffect(() => {
    if (reduced()) {
      setT(still)
      return
    }
    const el = ref.current
    let visible = false
    let raf = 0
    let last = 0
    let acc = 0
    const tick = (now: number) => {
      if (last) acc = (acc + Math.min(0.05, (now - last) / 1000)) % duration
      last = now
      setT(acc)
      raf = requestAnimationFrame(tick)
    }
    const start = () => {
      if (raf) return
      last = 0
      raf = requestAnimationFrame(tick)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible && !document.hidden) start()
      else stop()
    })
    if (el) io.observe(el)
    const onVis = () => (visible && !document.hidden ? start() : stop())
    document.addEventListener("visibilitychange", onVis)
    return () => {
      stop()
      io.disconnect()
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [duration, still])
  return { ref, t }
}

/* ------------------------------------------------------------------- stage */

/**
 * A W×H artboard that scales down to fit its parent's width, keeping its
 * aspect ratio. Children are laid out in artboard pixels.
 */
export function Stage({
  w,
  h,
  className,
  style,
  children,
  stageRef,
}: {
  w: number
  h: number
  className?: string
  style?: CSSProperties
  children: ReactNode
  stageRef?: React.Ref<HTMLDivElement>
}) {
  const box = useRef<HTMLDivElement>(null)
  const [s, setS] = useState(1)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setS(e.contentRect.width / w))
    ro.observe(el)
    return () => ro.disconnect()
  }, [w])
  return (
    <div ref={stageRef} className={cn("relative w-full max-w-full", className)} style={{ width: w, aspectRatio: `${w} / ${h}`, ...style }}>
      <div ref={box} className="absolute inset-0 overflow-hidden rounded-[18px]">
        <div className="absolute top-0 left-0 origin-top-left" style={{ width: w, height: h, transform: `scale(${s})` }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/** The default-export page: the scene centred on the app's gray with a label. */
export function ScenePage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#262626] p-8 font-sans">
      {children}
      <span className="text-[12px] text-white/45">{label}</span>
    </div>
  )
}

/* -------------------------------------------------------------- ui pieces */

// ClaudeIcon.tsx: 12 spokes, long and short alternating.
export const ClaudeIcon = ({ size = 14, className, style }: { size?: number; className?: string; style?: CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className={className} style={style} aria-hidden="true">
    {Array.from({ length: 12 }, (_, i) => {
      const a = (i * 30 * Math.PI) / 180
      const r = i % 2 === 0 ? 9 : 6.5
      return <line key={i} x1={12} y1={12} x2={12 + r * Math.cos(a)} y2={12 + r * Math.sin(a)} />
    })}
  </svg>
)

export const CLAUDE = "#d97757"
export const BLUE = "#3b82f6"

/** An arrow cursor, optionally with a name tag (for Claude's cursor). */
export function Cursor({
  x,
  y,
  press = 0,
  label,
  color = "#111",
  size = 26,
  style,
}: {
  x: number
  y: number
  press?: number
  label?: string
  color?: string
  size?: number
  style?: CSSProperties
}) {
  return (
    <div className="pointer-events-none absolute top-0 left-0 z-50" style={{ transform: `translate(${x}px, ${y}px)`, ...style }}>
      <svg width={size} height={size} viewBox="0 0 24 24" style={{ transform: `scale(${1 - press * 0.18})`, transformOrigin: "3px 2px", filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.35))" }}>
        <path d="M3.5 2.5 L3.5 19.5 L8.2 15.2 L11.3 22 L14.2 20.7 L11.2 14.1 L17.6 14.1 Z" fill={color} stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
      {label && (
        <span className="absolute top-[22px] left-[16px] flex items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-medium whitespace-nowrap text-white" style={{ background: color }}>
          {label}
        </span>
      )}
    </div>
  )
}

/** Blue selection outline with square white handles and an optional tag. */
export function Selection({ x, y, w, h, tag, opacity = 1, handles = true }: { x: number; y: number; w: number; h: number; tag?: string; opacity?: number; handles?: boolean }) {
  const hs = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]
  return (
    <div className="pointer-events-none absolute top-0 left-0 z-40" style={{ transform: `translate(${x}px, ${y}px)`, width: w, height: h, opacity }}>
      <div className="absolute inset-0 border-[1.5px]" style={{ borderColor: BLUE }} />
      {handles &&
        hs.map(([hx, hy], i) => (
          <span key={i} className="absolute size-[8px] border-[1.5px] bg-white" style={{ left: hx - 4, top: hy - 4, borderColor: BLUE }} />
        ))}
      {tag && (
        <span className="absolute -top-[22px] left-[-1px] rounded-[3px] px-1.5 py-[2px] font-mono text-[11px] leading-none font-medium text-white" style={{ background: BLUE }}>
          {tag}
        </span>
      )}
    </div>
  )
}

/** A frame on the canvas: its name above it, its content inside. */
export function CanvasFrame({
  name,
  x,
  y,
  w,
  h,
  children,
  className,
  style,
  labelColor = "rgba(255,255,255,0.4)",
}: {
  name: string
  x: number
  y: number
  w: number
  h: number
  children?: ReactNode
  className?: string
  style?: CSSProperties
  labelColor?: string
}) {
  return (
    <div className="absolute top-0 left-0" style={{ transform: `translate(${x}px, ${y}px)`, width: w, height: h, ...style }}>
      <span className="absolute -top-[20px] left-0 text-[12px] font-medium whitespace-nowrap" style={{ color: labelColor }}>
        {name}
      </span>
      <div className={cn("absolute inset-0 overflow-hidden", className)}>{children}</div>
    </div>
  )
}

/** A dotted halftone backdrop in a bold colour, like the videos' studio walls. */
export function Halftone({ bg, dot, className, size = 14 }: { bg: string; dot: string; className?: string; size?: number }) {
  const mask = "radial-gradient(ellipse 75% 80% at 50% 50%, transparent 30%, #000 85%)"
  return (
    <div className={cn("absolute inset-0", className)} style={{ background: bg }}>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(circle at center, ${dot} 0 30%, transparent 34%)`,
          backgroundSize: `${size}px ${size}px`,
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      />
    </div>
  )
}

/** A one-line composer pill, the kind that pops up on a selection. */
export function InlinePrompt({
  text,
  typed,
  sent = 0,
  placeholder = "Ask Claude to change this…",
  width = 520,
  style,
}: {
  text: string
  typed: number
  sent?: number
  placeholder?: string
  width?: number
  style?: CSSProperties
}) {
  const shown = text.slice(0, typed)
  return (
    <div
      className="flex items-center gap-3 rounded-[14px] border border-white/[0.08] bg-[#2a2a2a] py-2 pr-2 pl-3 font-sans shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
      style={{ width, ...style }}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-white/[0.06]">
        <ClaudeIcon size={15} style={{ color: CLAUDE }} />
      </span>
      <span className="flex-1 truncate text-[15px]" style={{ color: shown ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)" }}>
        {shown || placeholder}
        {typed > 0 && typed < text.length + 6 && sent === 0 && <span className="ml-px inline-block h-[1em] w-[1.5px] translate-y-[0.15em] bg-white/80" />}
      </span>
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-[#171717]"
        style={{ background: typed >= text.length ? "#fafafa" : "rgba(255,255,255,0.35)", transform: `scale(${1 - Math.sin(sent * Math.PI) * 0.18})` }}
      >
        <ArrowUp size={15} />
      </span>
    </div>
  )
}

/** macOS-ish window chrome around the Antidraw app. */
export function AppShell({ title, children, className, style }: { title: string; children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#1c1c1c] font-sans shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]", className)} style={style}>
      <div className="relative flex h-9 shrink-0 items-center border-b border-white/[0.06] px-3.5">
        <div className="flex gap-[7px]">
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <span key={c} className="size-[11px] rounded-full" style={{ background: c }} />
          ))}
        </div>
        <span className="absolute left-1/2 -translate-x-1/2 text-[12px] text-white/45">{title}</span>
      </div>
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  )
}

/** Chat column pieces. */
export function UserBubble({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="ml-6 rounded-[10px] bg-[#2f2f2f] px-3 py-2.5 text-[12.5px] leading-[1.5] text-white/85" style={style}>
      {children}
    </div>
  )
}

export function ChatComposer({ text = "Ask for changes…", typed, active }: { text?: string; typed?: number; active?: boolean }) {
  const shown = typed === undefined ? "" : text.slice(0, typed)
  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-[#2a2a2a] p-2">
      <div className="min-h-[34px] px-1.5 pt-0.5 pb-2 text-[12.5px] leading-[1.45]" style={{ color: shown ? "rgba(255,255,255,0.88)" : "rgba(255,255,255,0.35)" }}>
        {shown || "Ask for changes…"}
        {active && <span className="ml-px inline-block h-[1em] w-[1.5px] translate-y-[0.15em] bg-white/80" />}
      </div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 rounded-[7px] bg-white/[0.06] px-2 py-1 text-[11.5px] font-medium text-white/75">
          <ClaudeIcon size={12} style={{ color: CLAUDE }} />
          Claude
        </span>
        <span className="flex size-6 items-center justify-center rounded-full bg-white/80 text-[#171717]">
          <ArrowUp size={13} />
        </span>
      </div>
    </div>
  )
}

/** Stream-reveal of a sentence: words fade in as `p` goes 0 → 1. */
export function Stream({ text, p, className }: { text: string; p: number; className?: string }) {
  const words = text.split(" ")
  const n = p * words.length
  return (
    <p className={className}>
      {words.map((w, i) => (
        <span key={i} style={{ opacity: clamp(n - i) }}>
          {w}{" "}
        </span>
      ))}
    </p>
  )
}
