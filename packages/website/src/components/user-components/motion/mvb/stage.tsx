/**
 * Shared bits for the portrait "one capability, live" motion scenes
 * (MotionTimeline, MotionAccessibility, MotionPadding): a scaled 496×616
 * stage, a rAF loop clock that pauses offscreen and freezes under
 * prefers-reduced-motion, keyframe interpolation, cursors and Antidraw's
 * selection chrome.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export const STAGE_W = 496
export const STAGE_H = 616

export const BLUE = "#3b82f6"
export const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace"

/* ---------- easing + keyframes ---------- */

export type Ease = (x: number) => number
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const linear: Ease = (x) => x
export const easeInOut: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
export const easeOut: Ease = (x) => 1 - Math.pow(1 - x, 3)
export const easeIn: Ease = (x) => x * x * x
/** Natural "hand" move: slow start, quick middle, soft landing. */
export const glide: Ease = (x) => (x < 0.5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2)
/** Underdamped spring step, settles near 1 by x≈1. */
export const springy: Ease = (x) => {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const z = 0.42
  const w = 11
  const wd = w * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * w * x) * (Math.cos(wd * x) + ((z * w) / wd) * Math.sin(wd * x))
}

/** Keyframes: [time, value, easeIntoThisKey?]. Holds before the first / after the last. */
export type Key = [number, number, Ease?]
export function kf(t: number, keys: Key[]): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e] = keys[i]
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]
      const p = t1 === t0 ? 1 : (t - t0) / (t1 - t0)
      return lerp(v0, v1, (e ?? easeInOut)(p))
    }
  }
  return keys[keys.length - 1][1]
}

/** 0→1 window: fades in over [a, a+f], out over [b-f, b]. */
export function windowed(t: number, a: number, b: number, f = 0.2) {
  return Math.min(clamp01((t - a) / f), clamp01((b - t) / f))
}

/* ---------- loop clock ---------- */

/**
 * Seconds into a looping timeline of `duration`, ticking on rAF only while
 * `ref` is on screen. Under prefers-reduced-motion it stays at `still`.
 */
export function useLoopTime(duration: number, ref: React.RefObject<HTMLElement | null>, still: number) {
  const [t, setT] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    // ?motionT=<s> freezes the scene at that moment (posters, visual checks).
    const seek = parseFloat(new URLSearchParams(window.location.search).get("motionT") ?? "")
    if (reduce || Number.isFinite(seek)) {
      setT(Number.isFinite(seek) ? seek % duration : still)
      return
    }
    let raf = 0
    let last = 0
    let acc = 0
    let visible = false
    const tick = (now: number) => {
      if (last) acc = (acc + Math.min(0.05, (now - last) / 1000)) % duration
      last = now
      setT(acc)
      raf = requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !visible) {
        visible = true
        last = 0
        raf = requestAnimationFrame(tick)
      } else if (!e.isIntersecting && visible) {
        visible = false
        cancelAnimationFrame(raf)
      }
    })
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [duration, ref, still])
  return t
}

/* ---------- stage ---------- */

/** Fixed 496×616 artboard, scaled down to fit its parent's width. */
export function Stage({
  className,
  children,
  background = "#282828",
  innerRef,
}: {
  className?: string
  children: ReactNode
  background?: string
  innerRef?: React.RefObject<HTMLDivElement | null>
}) {
  const outer = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = outer.current
    if (!el) return
    const ro = new ResizeObserver(() => setScale(el.clientWidth / STAGE_W))
    ro.observe(el)
    setScale(el.clientWidth / STAGE_W)
    return () => ro.disconnect()
  }, [])
  return (
    <div
      ref={outer}
      className={cn("relative w-[496px] max-w-full overflow-hidden rounded-[20px] select-none", className)}
      style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}`, background }}
    >
      <div
        ref={innerRef}
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  )
}

export function ScenePage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#262626] p-6">
      {children}
      <div className="text-[12px] text-white/45">{label}</div>
    </div>
  )
}

/* ---------- chrome ---------- */

/** Antidraw selection: blue outline with square white handles at the corners. */
export function Selection({ x, y, w, h, opacity = 1 }: { x: number; y: number; w: number; h: number; opacity?: number }) {
  const hs = 7
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]
  return (
    <div className="pointer-events-none absolute" style={{ left: x, top: y, width: w, height: h, opacity }}>
      <div className="absolute inset-0" style={{ boxShadow: `0 0 0 1.5px ${BLUE}` }} />
      {corners.map(([cx, cy], i) => (
        <div
          key={i}
          className="absolute bg-white"
          style={{ left: cx - hs / 2, top: cy - hs / 2, width: hs, height: hs, boxShadow: `0 0 0 1.5px ${BLUE}` }}
        />
      ))}
    </div>
  )
}

/** Small frame name label, sitting above a frame. */
export function FrameLabel({ x, y, children, active }: { x: number; y: number; children: ReactNode; active?: boolean }) {
  return (
    <div
      className="absolute text-[11px] font-medium tracking-[-0.01em]"
      style={{ left: x, top: y - 18, color: active ? BLUE : "rgba(255,255,255,0.55)" }}
    >
      {children}
    </div>
  )
}

export type CursorKind = "arrow" | "ew" | "ns" | "grab"

/** Pointer cursor drawn at (x, y) = its hotspot. */
export function Cursor({ x, y, kind = "arrow", pressed = false }: { x: number; y: number; kind?: CursorKind; pressed?: boolean }) {
  const s = pressed ? 1.12 : 1.25
  const shadow = "drop-shadow(0 2px 3px rgba(0,0,0,0.35))"
  if (kind === "ew" || kind === "ns") {
    return (
      <svg
        width={30}
        height={30}
        viewBox="-15 -15 30 30"
        className="pointer-events-none absolute"
        style={{ left: x - 15, top: y - 15, transform: `rotate(${kind === "ns" ? 90 : 0}deg) scale(${s})`, filter: shadow }}
      >
        <path
          d="M-12 0 L-6 -6 L-6 -2.2 L6 -2.2 L6 -6 L12 0 L6 6 L6 2.2 L-6 2.2 L-6 6 Z"
          fill="#111"
          stroke="#fff"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
        <line x1={0} y1={-9} x2={0} y2={9} stroke="#fff" strokeWidth={3.4} strokeLinecap="round" />
        <line x1={0} y1={-9} x2={0} y2={9} stroke="#111" strokeWidth={1.4} strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 26 26"
      className="pointer-events-none absolute"
      style={{ left: x - 3, top: y - 2, transform: `scale(${s})`, transformOrigin: "3px 2px", filter: shadow }}
    >
      <path d="M3 2 L22 10.5 L13.2 13.2 L10.5 22 Z" fill="#111" stroke="#fff" strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  )
}

/** DialKit-style dark panel shell. */
export function Panel({ className, style, children }: { className?: string; style?: React.CSSProperties; children: ReactNode }) {
  return (
    <div
      className={cn("absolute rounded-[14px] border border-white/[0.08] bg-[#1c1c1c]/95 text-white shadow-[0_18px_50px_-12px_rgba(0,0,0,0.6)] backdrop-blur-md", className)}
      style={style}
    >
      {children}
    </div>
  )
}
