/**
 * Shared kit for the "canvas + AI" motion scenes: a looping timeline clock
 * (paused offscreen, frozen on a key frame with reduced motion), a
 * responsive stage, keyframe tracks, a camera, and Antidraw canvas bits —
 * frames with labels and selection, cursors, the Claude mark, skeletons.
 *
 * Everything reads one MotionValue `t` (seconds into the loop). Continuous
 * things (camera, cursors, sliders) are useTransform'd off it; discrete
 * beats use `useAt`, which only re-renders when its result changes.
 */
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { cubicBezier, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useTransform, type MotionValue } from "motion/react"

import { cn } from "@/lib/utils"
import { PillToggleToolbar } from "../../landing-canvas/PillToggleToolbar"
import agentIconUrl from "../../landing/antidraw-icon.svg?url"

/* ── Easing & keyframes ──────────────────────────────────────────────── */

export type Ease = (x: number) => number

/** A damped-spring settle, as an easing curve (overshoots a little). */
const springEase =
  (bounce = 0.35, freq = 2.2): Ease =>
  (x) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    const decay = 3 + (1 - bounce) * 6
    const f = (u: number) => 1 - Math.exp(-decay * u) * Math.cos(freq * Math.PI * u)
    return f(x) / f(1)
  }

export const E = {
  linear: ((x) => x) as Ease,
  inOut: cubicBezier(0.65, 0, 0.35, 1) as Ease,
  out: cubicBezier(0.22, 1, 0.36, 1) as Ease,
  in: cubicBezier(0.55, 0, 0.75, 0.2) as Ease,
  // Figma-ish camera: quick start, long soft landing.
  cam: cubicBezier(0.7, 0, 0.18, 1) as Ease,
  spring: springEase(0.35, 2.2),
  pop: springEase(0.55, 2.6),
}

/** [time, value, ease-into-this-key] */
export type Key = readonly [number, number, Ease?]

export function kf(t: number, keys: readonly Key[]): number {
  if (t <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease = E.inOut] = keys[i]
    if (t <= t1) {
      const [t0, v0] = keys[i - 1]
      const p = t1 === t0 ? 1 : ease((t - t0) / (t1 - t0))
      return v0 + (v1 - v0) * p
    }
  }
  return keys[keys.length - 1][1]
}

/** 0→1 over [a, b] with an ease. */
export const ramp = (t: number, a: number, b: number, ease: Ease = E.inOut) => (t <= a ? 0 : t >= b ? 1 : ease((t - a) / (b - a)))
export const mix = (a: number, b: number, p: number) => a + (b - a) * p

/** [time, x, y, ease, straight] — y lags x a touch so moves arc, unless `straight` (drags that must track a knob). */
export type PathKey = readonly [number, number, number, Ease?, boolean?]
export function path(t: number, keys: readonly PathKey[]): [number, number] {
  if (t <= keys[0][0]) return [keys[0][1], keys[0][2]]
  for (let i = 1; i < keys.length; i++) {
    const [t1, x1, y1, ease = E.inOut, straight = false] = keys[i]
    if (t <= t1) {
      const [t0, x0, y0] = keys[i - 1]
      const p = ease((t - t0) / (t1 - t0))
      const q = straight ? p : ease(Math.min(1, ((t - t0) / (t1 - t0)) * 1.18))
      return [mix(x0, x1, q), mix(y0, y1, p)]
    }
  }
  const k = keys[keys.length - 1]
  return [k[1], k[2]]
}

/** How many characters of `text` are typed at t (typing from a to b, with a human jitter). */
export function typed(t: number, a: number, b: number, text: string) {
  if (t <= a) return 0
  if (t >= b) return text.length
  const n = text.length
  // Cumulative per-char weights: spaces and punctuation take a little longer.
  let total = 0
  const w: number[] = []
  for (let i = 0; i < n; i++) {
    const c = text[i]
    const jitter = 0.7 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.6
    total += (c === " " ? 1.5 : /[.,?!]/.test(c) ? 2 : 1) * jitter
    w.push(total)
  }
  const target = ((t - a) / (b - a)) * total
  let k = 0
  while (k < n && w[k] <= target) k++
  return k
}

/* ── Clock & stage ───────────────────────────────────────────────────── */

type SceneCtx = { t: MotionValue<number>; duration: number; width: number; height: number }

/**
 * How the scenes inside play: "live" loops (the default); "still" holds each on its `still` frame,
 * as reduced motion does (thumbnails that only play on hover).
 */
export const ScenePlayback = createContext<"live" | "still">("live")
/**
 * True while a scene is on screen but can't be seen, as a use-case row covered by the next one in its
 * stack: its clock stops where it is (unlike "still", which jumps to the still frame) and its CSS animations pause.
 */
export const ScenePaused = createContext(false)
const Ctx = createContext<SceneCtx | null>(null)

export function useScene() {
  const c = useContext(Ctx)
  if (!c) throw new Error("useScene outside <Scene>")
  return c
}

/** A derived value of t that re-renders only when it changes (keep it primitive). */
export function useAt<T extends string | number | boolean>(fn: (t: number) => T): T {
  const { t } = useScene()
  const fnRef = useRef(fn)
  fnRef.current = fn
  const [v, setV] = useState<T>(() => fn(t.get()))
  useMotionValueEvent(t, "change", (x) => {
    const n = fnRef.current(x)
    setV((p) => (Object.is(p, n) ? p : n))
  })
  return v
}

/** A MotionValue derived from t. */
export function useTrack<T>(fn: (t: number) => T): MotionValue<T> {
  const { t } = useScene()
  const fnRef = useRef(fn)
  fnRef.current = fn
  return useTransform(t, (x) => fnRef.current(x))
}

/**
 * The stage: a `width × height` scene that scales down to its parent's width
 * (keeping aspect), runs the loop clock while on screen, and holds still on
 * `still` (seconds) when the user prefers reduced motion.
 */
export function Scene({
  width,
  height,
  duration,
  still,
  className,
  style,
  children,
}: {
  width: number
  height: number
  duration: number
  still: number
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const playback = useContext(ScenePlayback)
  const paused = useContext(ScenePaused)
  const reduce = reducedMotion || playback === "still"
  const t = useMotionValue(reduce ? still : 0)
  const outer = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [visible, setVisible] = useState(false)

  // Fit to the box before the first paint, so a scene never shows a frame at its full natural size.
  useLayoutEffect(() => {
    const el = outer.current
    if (el?.clientWidth) setScale(el.clientWidth / width)
  }, [width])

  useEffect(() => {
    const el = outer.current!
    const ro = new ResizeObserver(() => setScale(el.clientWidth / width))
    ro.observe(el)
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.01 })
    io.observe(el)
    return () => {
      ro.disconnect()
      io.disconnect()
    }
  }, [width])

  useEffect(() => {
    if (reduce) {
      t.set(still)
      return
    }
    if (!visible || paused) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      // Clamp long gaps (tab switches) so the loop doesn't jump.
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      t.set((t.get() + dt) % duration)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduce, visible, paused, duration, still, t])

  // Off screen or covered, its CSS loops (spinners, shimmers, carets) pause too, through global.css's
  // [data-paused] rule, and resume from where they stopped. Not when held "still": a still frame can carry
  // one-shot entrances (the *-pop classes) that would freeze on their first, invisible frame. It starts
  // paused: `visible` is false until the observer reports, on the server and on the first client render alike.
  const idle = !visible || paused
  return (
    <div
      ref={outer}
      data-paused={idle ? "" : undefined}
      className={cn("relative w-full max-w-full overflow-hidden", className)}
      style={{ maxWidth: width, aspectRatio: `${width} / ${height}`, ...style }}
    >
      <div className="absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
        <Ctx.Provider value={{ t, duration, width, height }}>{children}</Ctx.Provider>
      </div>
    </div>
  )
}

/** The default-export page every scene sits on. */
export function ScenePage({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#262626] p-8 font-sans">
      <div className="flex w-full max-w-[1366px] flex-col items-center gap-3">
        <div className="self-start text-[12px] text-white/45">{label}</div>
        {children}
      </div>
    </div>
  )
}

/* ── Camera ──────────────────────────────────────────────────────────── */

export type Cam = { x: number; y: number; s: number }
const CamCtx = createContext<{ s: MotionValue<number>; cam: (t: number) => Cam } | null>(null)
export const useCam = () => {
  const c = useContext(CamCtx)
  if (!c) throw new Error("useCam outside <Camera>")
  return c
}

/**
 * World layer: `cam(t)` says which world point sits at the centre of the stage, and the zoom.
 * `overlay` is drawn on top in stage space (cursors, comments) and can map world points with useToScreen.
 */
export function Camera({ cam, children, overlay, className }: { cam: (t: number) => Cam; children: ReactNode; overlay?: ReactNode; className?: string }) {
  const { width, height } = useScene()
  const transform = useTrack((t) => {
    const c = cam(t)
    return `translate(${width / 2}px, ${height / 2}px) scale(${c.s}) translate(${-c.x}px, ${-c.y}px)`
  })
  const s = useTrack((t) => cam(t).s)
  return (
    <CamCtx.Provider value={{ s, cam }}>
      <motion.div className={cn("absolute top-0 left-0 origin-top-left", className)} style={{ transform, willChange: "transform" }}>
        {children}
      </motion.div>
      {overlay}
    </CamCtx.Provider>
  )
}

/** World → stage coordinates, for things that live on top (cursors, popovers) and don't zoom. */
export function useToScreen() {
  const { width, height } = useScene()
  const { cam } = useCam()
  return (t: number, wx: number, wy: number): [number, number] => {
    const c = cam(t)
    return [width / 2 + (wx - c.x) * c.s, height / 2 + (wy - c.y) * c.s]
  }
}

/* ── Antidraw bits ───────────────────────────────────────────────────── */

export const BLUE = "#3b82f6"
export const CLAUDE = "#d97757"
/** The agent's cursor on the canvas: Antidraw's, in its icon's blue. */
export const AGENT = "#3a5fb0"
export const AgentIcon = ({ size = 12 }: { size?: number }) => <img src={agentIconUrl} alt="" width={size} height={size} className="shrink-0 rounded-[3px]" />
export const CANVAS = "#282828"

/** Claude's mark: 12 spokes, long and short alternating. */
export function ClaudeMark({ size = 14, className, strokeWidth = 1.8 }: { size?: number; className?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" className={cn("text-[#d97757]", className)} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180
        const r = i % 2 === 0 ? 9.5 : 6.5
        return <line key={i} x1={12} y1={12} x2={12 + r * Math.cos(a)} y2={12 + r * Math.sin(a)} />
      })}
    </svg>
  )
}

/**
 * A frame on the canvas, in world coordinates: the name label (Antidraw's
 * toolbar pill when selected) sits above it at screen size, the blue
 * selection outline and square handles stay crisp at any zoom.
 */
export function Frame({
  name,
  x,
  y,
  w,
  h,
  selected = false,
  label = true,
  opacity,
  scale,
  children,
  className,
  style,
}: {
  name: string
  x: number
  y: number
  w: number
  h: number
  selected?: boolean
  /** Hide the name label (e.g. for frames buried under others). */
  label?: boolean
  opacity?: MotionValue<number> | number
  scale?: MotionValue<number> | number
  children?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  const { s } = useCam()
  const inv = useTransform(s, (v) => 1 / v)
  const ring = useTransform(s, (v) => `0 0 0 ${1.5 / v}px ${BLUE}`)
  return (
    <motion.div className="absolute" style={{ left: x, top: y, width: w, height: h, opacity, scale }}>
      <motion.div className="absolute bottom-full left-0 origin-bottom-left pb-0.5 transition-opacity duration-200" style={{ scale: inv, opacity: label ? 1 : 0 }}>
        <PillToggleToolbar componentName={name} nodeId={name} selected={selected} onSeeCode={() => {}} />
      </motion.div>
      <div className={cn("absolute inset-0 overflow-hidden rounded-[4px]", className)} style={style}>
        {children}
      </div>
      <motion.div
        className="pointer-events-none absolute inset-0 rounded-[4px] transition-opacity duration-200"
        style={{ boxShadow: ring, opacity: selected ? 1 : 0 }}
      >
        {[
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ].map(([cx, cy]) => (
          <motion.span
            key={`${cx}${cy}`}
            className="absolute size-[8px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] border-[1.5px] bg-white"
            style={{ left: `${cx * 100}%`, top: `${cy * 100}%`, borderColor: BLUE, scale: inv }}
          />
        ))}
      </motion.div>
    </motion.div>
  )
}

/** Render `children` at a natural size, scaled into a w×h box (centred; `cover` crops instead of letterboxing). */
export function Fit({ w, h, nw, nh, cover = false, children, className, style }: { w: number; h: number; nw: number; nh: number; cover?: boolean; children: ReactNode; className?: string; style?: CSSProperties }) {
  const s = cover ? Math.max(w / nw, h / nh) : Math.min(w / nw, h / nh)
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ width: w, height: h, ...style }}>
      <div className="absolute top-1/2 left-1/2" style={{ width: nw, height: nh, transform: `translate(-50%, -50%) scale(${s})` }}>
        {children}
      </div>
    </div>
  )
}

/** A frame that's still being made: a soft shimmer. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("absolute inset-0 overflow-hidden bg-[#323232]", className)}>
      <div className="mvc-shimmer absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
      <div className="absolute top-[10%] left-[8%] h-[6%] w-[40%] rounded-full bg-white/[0.05]" />
      <div className="absolute top-[22%] left-[8%] h-[30%] w-[84%] rounded-[6px] bg-white/[0.04]" />
      <div className="absolute top-[58%] left-[8%] h-[5%] w-[60%] rounded-full bg-white/[0.04]" />
      <div className="absolute top-[67%] left-[8%] h-[5%] w-[70%] rounded-full bg-white/[0.04]" />
      <style>{`@keyframes mvc-shimmer { from { transform: translateX(0) } to { transform: translateX(300%) } } .mvc-shimmer { animation: mvc-shimmer 1.3s cubic-bezier(.4,0,.2,1) infinite }`}</style>
    </div>
  )
}

/** A cursor on the stage (screen space): an arrow, and a name tag. */
export function Cursor({
  x,
  y,
  color = "#ffffff",
  label,
  claude = false,
  opacity,
  press,
}: {
  x: MotionValue<number>
  y: MotionValue<number>
  color?: string
  label?: string
  claude?: boolean
  opacity?: MotionValue<number> | number
  press?: MotionValue<number>
}) {
  // `claude` marks the agent's cursor; on the canvas it's Antidraw's.
  const fill = claude ? AGENT : color
  const dark = !claude && color === "#ffffff"
  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-50" style={{ x, y, opacity }}>
      <motion.div style={{ scale: press }} className="origin-top-left">
        <svg width="22" height="22" viewBox="0 0 22 22" className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]">
          <path d="M3 2.5 L3 17.5 L7.2 13.6 L10.1 19.6 L12.6 18.4 L9.8 12.6 L15.5 12.4 Z" fill={dark ? "#111" : fill} stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </motion.div>
      {label && (
        <div
          className="absolute top-[18px] left-[14px] flex items-center gap-1 rounded-[5px] px-1.5 py-[3px] text-[11px] font-semibold whitespace-nowrap text-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
          style={{ background: dark ? "#111" : fill }}
        >
          {claude && <AgentIcon size={12} />}
          {label}
        </div>
      )}
    </motion.div>
  )
}

/** A cursor that follows a world-space path (so it rides along with the camera). */
export function WorldCursor({ keys, ...rest }: { keys: readonly PathKey[] } & Omit<Parameters<typeof Cursor>[0], "x" | "y">) {
  const toScreen = useToScreen()
  const x = useTrack((t) => toScreen(t, ...path(t, keys))[0])
  const y = useTrack((t) => toScreen(t, ...path(t, keys))[1])
  return <Cursor x={x} y={y} {...rest} />
}
