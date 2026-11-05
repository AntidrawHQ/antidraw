/**
 * Small shared bits for the motion-tooling scenes (MotionAdjustTiming,
 * MotionHero, MotionPresets, MotionReuse, MotionTransitions,
 * MotionSwapVariables): a cubic-bezier solver, a timeline ruler + playhead,
 * and the yellow "bloom" flower glyph that several scenes animate.
 */
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export const BLUE = "#3b82f6"
export const LIME = "#e6ff4f"
export const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace"

/* ---------- cubic bezier (same math browsers use) ---------- */

export function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x
      if (Math.abs(e) < 1e-5) return sy(t)
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= e / d
    }
    let lo = 0
    let hi = 1
    t = x
    for (let i = 0; i < 24; i++) {
      const v = sx(t)
      if (Math.abs(v - x) < 1e-5) break
      if (x > v) lo = t
      else hi = t
      t = (lo + hi) / 2
    }
    return sy(t)
  }
}

/** Damped spring step response, 0→1 (overshoots when bounce > 0). */
export function springStep(x: number, bounce = 0.35, speed = 10) {
  if (x <= 0) return 0
  const z = Math.max(0.05, 1 - bounce)
  if (z >= 1) return 1 - Math.exp(-speed * x) * (1 + speed * x)
  const wd = speed * Math.sqrt(1 - z * z)
  return 1 - Math.exp(-z * speed * x) * (Math.cos(wd * x) + ((z * speed) / wd) * Math.sin(wd * x))
}

/* ---------- bloom glyph ---------- */

/**
 * Eight-petal "bloom" mark: stems radiating from a ring, each ending in a
 * loop. `open` 0→1 pushes the petals out and grows their loops; `spin` in deg.
 */
export function Bloom({
  size,
  open,
  spin = 0,
  color = LIME,
  stroke = 7,
  petals = 8,
  className,
}: {
  size: number
  open: number
  spin?: number
  color?: string
  stroke?: number
  petals?: number
  className?: string
}) {
  const r0 = 13 + open * 5
  const len = 26 + open * 16
  const loop = 9 + open * 5
  return (
    <svg width={size} height={size} viewBox="-60 -60 120 120" className={className} style={{ overflow: "visible" }}>
      <g transform={`rotate(${spin})`} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round">
        <circle r={r0} />
        {Array.from({ length: petals }, (_, i) => {
          const a = (i / petals) * Math.PI * 2
          const c = Math.cos(a)
          const s = Math.sin(a)
          const end = r0 + len
          return (
            <g key={i}>
              <line x1={c * r0} y1={s * r0} x2={c * (end - loop)} y2={s * (end - loop)} />
              <circle cx={c * end} cy={s * end} r={loop} />
            </g>
          )
        })}
      </g>
    </svg>
  )
}

/* ---------- timeline ---------- */

/** Ruler with second ticks across `width`, from 0 to `max` seconds. */
export function Ruler({ width, max, step = 0.2, className }: { width: number; max: number; step?: number; className?: string }) {
  const n = Math.round(max / step)
  return (
    <div className={cn("relative h-5", className)} style={{ width }}>
      {Array.from({ length: n + 1 }, (_, i) => (
        <div key={i} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: (i / n) * width }}>
          <span className="text-[10px] tabular-nums text-white/40" style={{ fontFamily: MONO }}>
            {i === 0 ? "0" : (i * step).toFixed(1)}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Blue playhead: a knob on the ruler plus a hairline down through the tracks. */
export function Playhead({ x, height, top = 0 }: { x: number; height: number; top?: number }) {
  return (
    <div className="pointer-events-none absolute z-10" style={{ left: x, top, height }}>
      <div className="absolute -left-[6px] -top-[2px] h-[12px] w-[12px] rounded-full" style={{ background: BLUE, boxShadow: "0 0 0 2px #1e1e1e" }} />
      <div className="absolute left-[-0.75px] top-[8px] bottom-0 w-[1.5px]" style={{ background: BLUE }} />
    </div>
  )
}

/** Clip bar on a track. */
export function Clip({ x, w, label, color = BLUE, active, children }: { x: number; w: number; label?: string; color?: string; active?: boolean; children?: ReactNode }) {
  return (
    <div
      className="absolute top-1/2 flex h-[18px] -translate-y-1/2 items-center justify-between rounded-[5px] px-1.5 text-[10px] font-medium text-white"
      style={{ left: x, width: w, background: color, boxShadow: active ? "0 0 0 1.5px #fff" : undefined }}
    >
      <span className="h-[8px] w-[2px] rounded-full bg-white/70" />
      {label && <span className="truncate px-1">{label}</span>}
      {children}
      <span className="h-[8px] w-[2px] rounded-full bg-white/70" />
    </div>
  )
}

/** Claude's spoked asterisk. */
export function ClaudeMark({ size = 16, color = "#d97757" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="-12 -12 24 24">
      <g stroke={color} strokeWidth={2.6} strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2 + 0.2
          const r = i % 2 ? 8 : 10.5
          return <line key={i} x1={Math.cos(a) * 2.5} y1={Math.sin(a) * 2.5} x2={Math.cos(a) * r} y2={Math.sin(a) * r} />
        })}
      </g>
    </svg>
  )
}
