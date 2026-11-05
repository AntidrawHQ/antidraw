/**
 * Designers · "Animations other tools can't do": springs, drags and flings
 * you can feel, tuned on the real component instead of faked with dissolves.
 *
 * Same language as UseCasePMRealData, on a transparent stage:
 *   0–3.7s    PickStack (Dog-ear, a book-club app: tonight's picks as a card
 *             stack) is on the canvas. The designer selects it and asks:
 *             "Make these cards swipeable, with a springy, physical feel I
 *             can tune."
 *   3.9–6.6s  The agent reads the file, adds drag, fling and spring physics,
 *             and adds spring controls with DialKit; the panel shimmers in
 *             beside the phone (a response curve, Stiffness, Bounce). The
 *             reply invites a fling.
 *   7.6–9.2s  First try: the pointer grabs the top card and drags it right.
 *             It follows with a tilt and lifts, "Want to read" stamps in, the
 *             card behind rises. Let go, it springs home almost dead (bounce
 *             0.15), a dot riding the curve in the panel.
 *   9.9–11s   The designer drags Bounce 0.15 → 0.62. The curve redraws live
 *             with a deeper overshoot, the old one left as a ghost.
 *   11.7–13.7s Same drag, same release: now it overshoots past centre and
 *             wobbles twice before it settles, the dot tracing the new curve.
 *   14.1s     A real fling: a quick throw right, the card keeps its speed and
 *             sails off the phone; Stoner springs up to the top with a little
 *             overshoot; Want to read ticks 12 → 13.
 *   15.3s–    Held, then a fade through the loop seam.
 *
 * Every card position is physics, not keyframes: while held the card is
 * the pointer's offset; once let go it's an analytic damped spring
 * (usecase/design/springs.tsx springAt) from the release offset and
 * velocity, at the stiffness and bounce the panel showed at release.
 *
 * Pieces: usecase/design/chat.tsx. App, physics and the DialKit panel:
 * usecase/design/springs.tsx.
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { BLUE, Cursor, E, Scene, ScenePage, Skeleton, kf, path, ramp, typed, useAt, useTrack, type Ease, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Chip, Reveal, ToolGroup, ToolRow } from "../usecase/design/chat"
import { BOOKS, CARD_GRAB, PANEL_W, PICK_H, PICK_W, PickStack, SpringPanel, slot, springAt, type CardMotion } from "../usecase/design/springs"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 17.5
const STILL = 16.4

const NAME = "PickStack"
const PROMPT = "Make these cards swipeable, with a springy, physical feel I can tune."
const T = { select: 0.8, type: [1.25, 3.25] as const, send: 3.65, reply: 6.6 }

const ROWS = [
  { title: `Read ${NAME}.tsx`, start: 3.9, done: 4.6 },
  { title: "Drag, fling and spring physics", start: 4.6, done: 5.7 },
  { title: "Spring controls with DialKit", start: 5.7, done: 6.35 },
]

/* ── Layout ───────────────────────────────────────────────────────────── */

const CHAT = { x: 144, y: 96, w: 300, h: 570 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]

const PS = 0.95
const PHONE = { x: 514, y: 96, w: PICK_W * PS, h: PICK_H * PS }
const phonePt = ([fx, fy]: readonly [number, number]): [number, number] => [PHONE.x + fx * PS, PHONE.y + fy * PS]

const PANEL = { x: 855, y: 96 }
const PANEL_SKEL = [5.7, 6.0] as const
const PANEL_FILL = [6.05, 6.45] as const
// The Bounce slider's track, measured in the panel (stage px).
const SL = { x0: PANEL.x + 13, w: 254, y: PANEL.y + 265 }
const bounceX = (b: number) => SL.x0 + b * SL.w - 7

/* ── The physics ──────────────────────────────────────────────────────── */

const K = 180
const B0 = 0.15
const B1 = 0.62
const SLIDE = [10.0, 10.9] as const
const bounceAt = (t: number) => Math.round(kf(t, [[SLIDE[0], B0], [SLIDE[1], B1, E.inOut]]) * 100) / 100

type Drag = { g: number; r: number; fling?: boolean }
/** Grab and release times: two drags that are let go to spring home, then a throw. */
const DRAGS: Drag[] = [
  { g: 7.65, r: 8.5 },
  { g: 11.7, r: 12.55 },
  { g: 14.1, r: 14.38, fling: true },
]
const [D1, D2, D3] = DRAGS
const PULL: [number, number] = [108, -10]
const THROW: [number, number] = [125, -22]
/** A thrown card keeps its speed, losing it to friction at this rate (1/s). */
const FRICTION = 1.5

/* ── The pointer ──────────────────────────────────────────────────────── */

const GRAB = phonePt(CARD_GRAB)
const at = (p: [number, number], d: [number, number]): [number, number] => [p[0] + d[0], p[1] + d[1]]
const quadIn: Ease = (x) => x * x
const REST: [number, number] = [790, 610]

const YOU: PathKey[] = [
  [0, 900, 650],
  [T.select - 0.45, 900, 650],
  [T.select - 0.05, ...phonePt([200, 420]), E.inOut],
  [T.select + 0.15, ...phonePt([200, 420])],
  [T.send - 0.5, ...phonePt([200, 420])],
  [T.send - 0.1, ...SEND_AT, E.inOut],
  [T.send + 0.4, ...SEND_AT],
  [6.4, ...REST, E.inOut],
  [7.0, ...REST],
  [D1.g - 0.1, ...GRAB, E.inOut],
  [D1.g, ...GRAB],
  [D1.r - 0.12, ...at(GRAB, PULL), E.inOut, true],
  [D1.r, ...at(GRAB, PULL)],
  [9.35, ...at(GRAB, PULL)],
  [SLIDE[0] - 0.12, bounceX(B0), SL.y, E.inOut],
  [SLIDE[0], bounceX(B0), SL.y],
  [SLIDE[1], bounceX(B1), SL.y, E.inOut, true],
  [SLIDE[1] + 0.2, bounceX(B1), SL.y],
  [D2.g - 0.1, ...GRAB, E.inOut],
  [D2.g, ...GRAB],
  [D2.r - 0.12, ...at(GRAB, PULL), E.inOut, true],
  [D2.r, ...at(GRAB, PULL)],
  [13.3, ...at(GRAB, PULL)],
  [D3.g - 0.1, ...GRAB, E.inOut],
  [D3.g, ...GRAB],
  [D3.r, ...at(GRAB, THROW), quadIn, true],
  [D3.r + 0.4, ...at(GRAB, [THROW[0] + 60, THROW[1] - 12]), E.out, true],
  [15.8, ...REST, E.inOut],
  [DUR, ...REST],
]
const ptr = (t: number) => path(t, YOU)
const CLICKS = [T.select, T.send]
const holding = (t: number) => DRAGS.some((d) => t >= d.g && t < d.r) || (t >= SLIDE[0] - 0.02 && t < SLIDE[1] + 0.12)

/* ── The top card ─────────────────────────────────────────────────────── */

type Card = { x: number; y: number; lift: number; d: Drag | null }

/** The top card at t, in frame px: the pointer's offset while held, physics once let go. */
function top(t: number): Card {
  const d = [...DRAGS].reverse().find((d) => t >= d.g)
  if (!d) return { x: 0, y: 0, lift: 0, d: null }
  const [gx, gy] = ptr(d.g)
  if (t < d.r) {
    const [px, py] = ptr(t)
    return { x: (px - gx) / PS, y: (py - gy) / PS, lift: ramp(t, d.g, d.g + 0.18, E.out), d }
  }
  const [rx, ry] = ptr(d.r)
  const [qx, qy] = ptr(d.r - 1 / 240)
  const x0 = (rx - gx) / PS
  const y0 = (ry - gy) / PS
  const vx = ((rx - qx) * 240) / PS
  const vy = ((ry - qy) * 240) / PS
  const tau = t - d.r
  if (d.fling) {
    const k = (1 - Math.exp(-FRICTION * tau)) / FRICTION
    return { x: x0 + vx * k, y: y0 + vy * k, lift: 1, d }
  }
  const b = bounceAt(d.r)
  return { x: springAt(tau, x0, vx, K, b), y: springAt(tau, y0, vy, K, b), lift: springAt(tau, 1, 0, K, b), d }
}

/** How far the stack has moved up: the cards behind rise as the top one is pulled, and spring into place once it's thrown. */
function advance(t: number) {
  const pulled = (c: Card) => 0.45 * Math.min(1, Math.hypot(c.x, c.y) / 200)
  if (t < D3.r) return pulled(top(t))
  const a0 = pulled(top(D3.r))
  return 1 - springAt(t - D3.r, 1 - a0, 0, K, bounceAt(D3.r))
}

/** How sure the drag looks: the "Want to read" stamp and the save button swell with it; after the throw the button springs back. */
function stampAt(t: number) {
  const of = (x: number) => Math.min(1, Math.max(0, (x - 30) / 70))
  if (t < D3.r) return of(top(t).x)
  return of(top(D3.r).x) * springAt(t - D3.r, 1, 0, K, bounceAt(D3.r))
}

/** The dot on the panel's curve: seconds since a card was let go to spring home (-1: none). */
const traceAt = (t: number) => {
  const d = [D1, D2].find((d) => t >= d.r && t < d.r + 1.6)
  return d ? Math.round((t - d.r) * 60) / 60 : -1
}

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Chat() {
  const opacity = useTrack((t) => ramp(t, 0.2, 0.6))
  const typing = useAt((t) => t < T.send)
  const n = useAt((t) => typed(t, T.type[0], T.type[1], PROMPT))
  const press = useAt((t) => Math.round(Math.sin(Math.PI * ramp(t, T.send - 0.08, T.send + 0.12, E.linear)) * 10) / 10)
  const sent = useAt((t) => t >= T.send + 0.1)
  const frameChip = useAt((t) => t >= T.select + 0.05 && t < T.send)
  const shown = useAt((t) => ROWS.filter((r) => t >= r.start).length)
  const finished = useAt((t) => ROWS.filter((r) => t >= r.done).length)
  const reply = useAt((t) => t >= T.reply)
  return (
    <motion.div
      className="absolute flex flex-col overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#2A2A2A] font-sans shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)]"
      style={{ left: CHAT.x, top: CHAT.y, width: CHAT.w, height: CHAT.h, opacity }}
    >
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-3 pb-1">
        <Reveal on={sent}>
          <div className="flex flex-col items-end">
            <div className="flex flex-wrap justify-end gap-1.5 pb-1">
              <Chip frame={NAME} />
            </div>
            <div className="max-w-[92%] rounded-[6px] bg-neutral-700 p-2 text-[13px] leading-[1.55] break-words whitespace-pre-wrap text-neutral-200">{PROMPT}</div>
          </div>
        </Reveal>
        <Reveal on={shown > 0}>
          <ToolGroup>
            {ROWS.slice(0, Math.max(1, shown)).map((r, i) => (
              <ToolRow key={i} title={r.title} running={i >= finished} />
            ))}
          </ToolGroup>
        </Reveal>
        <Reveal on={reply}>
          <AssistantText>Cards follow your finger now, tilt as you drag, and spring home or fly off depending on how hard you throw. Stiffness and Bounce are on the panel, so give it a fling.</AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 min-h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 pb-11 shadow-xs">
        {frameChip && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <Chip frame={NAME} className="da-pop" />
          </div>
        )}
        <div className="pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {typing && n > 0 ? PROMPT.slice(0, n) : <span className="text-neutral-400">Ask me anything...</span>}
          {typing && n > 0 && <span className="da-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
        </div>
        <span
          className={cn("absolute right-2 bottom-2 grid size-7 place-items-center rounded-full bg-neutral-50 text-neutral-900", (!typing || n === 0) && "opacity-50")}
          style={{ transform: `scale(${1 - press * 0.12})` }}
        >
          <ArrowUp className="size-3.5" />
        </span>
      </div>
    </motion.div>
  )
}

/** Motion for book i: the top card follows the physics, the rest sit in the stack. */
function useCard(i: number): CardMotion {
  const x = useTrack((t) => (i === 0 ? top(t).x : 0))
  const y = useTrack((t) => (i === 0 ? top(t).y : slot(i, advance(t)).y))
  const rotate = useTrack((t) => (i === 0 ? top(t).x / 17 : 0))
  const scale = useTrack((t) => (i === 0 ? 1 + 0.03 * top(t).lift : slot(i, advance(t)).scale))
  const opacity = useTrack((t) => (i === 0 ? (t >= D3.r + 1 ? 0 : 1) : slot(i, advance(t)).opacity))
  const stamp = useTrack((t) => (i === 0 ? stampAt(t) : 0))
  const shadow = useTrack((t) => {
    const l = i === 0 ? Math.max(0, top(t).lift) : 0
    return `0 ${6 + 12 * l}px ${18 + 18 * l}px -8px rgba(31,28,23,${(0.22 + 0.14 * l).toFixed(3)})`
  })
  return { x, y, rotate, scale, opacity, stamp: i === 0 ? stamp : undefined, shadow }
}

/** A screen at frame size, scaled. */
const Fit = ({ s, children }: { s: number; children: ReactNode }) => (
  <div className="relative origin-top-left" style={{ width: PICK_W, height: PICK_H, scale: s }}>
    {children}
  </div>
)

function Phone() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const selected = useAt((t) => t >= T.select && t < T.send)
  const c0 = useCard(0)
  const c1 = useCard(1)
  const c2 = useCard(2)
  const c3 = useCard(3)
  const hot = useTrack((t) => 1 + 0.14 * stampAt(t))
  const saved = useAt((t) => (t >= D3.r + 0.2 ? 13 : 12))
  return (
    <motion.div className="absolute font-sans" style={{ left: PHONE.x, top: PHONE.y - 22, width: PHONE.w, opacity }}>
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">{NAME}</div>
      <div className="relative overflow-hidden rounded-[22px] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.08]" style={{ height: PHONE.h }}>
        <Fit s={PS}>
          <PickStack cards={[c0, c1, c2, c3].slice(0, BOOKS.length)} saved={saved} hot={hot} />
        </Fit>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-[22px] transition-opacity duration-200" style={{ top: 22, boxShadow: `0 0 0 1.5px ${BLUE}`, opacity: selected ? 1 : 0 }} />
    </motion.div>
  )
}

function Panel() {
  const skel = useAt((t) => t >= PANEL_SKEL[0] && t < PANEL_FILL[1] + 0.1)
  const skelOp = useTrack((t) => ramp(t, PANEL_SKEL[0], PANEL_SKEL[1]) * (1 - ramp(t, PANEL_FILL[1] - 0.1, PANEL_FILL[1] + 0.1)))
  const built = useAt((t) => t >= PANEL_FILL[0])
  const clipPath = useTrack((t) => `inset(0 0 ${(1 - ramp(t, PANEL_FILL[0], PANEL_FILL[1], E.inOut)) * 100}% 0 round 14px)`)
  const bounce = useAt(bounceAt)
  const ghost = useAt((t) => t >= SLIDE[0])
  const tau = useAt(traceAt)
  const active = useAt((t) => t >= SLIDE[0] - 0.15 && t < SLIDE[1] + 0.3)
  return (
    <div className="absolute" style={{ left: PANEL.x, top: PANEL.y, width: PANEL_W }}>
      {skel && (
        <motion.div className="absolute inset-x-0 top-0 h-[293px] overflow-hidden rounded-[14px]" style={{ opacity: skelOp }}>
          <Skeleton />
        </motion.div>
      )}
      {built && (
        <motion.div style={{ clipPath }}>
          <SpringPanel stiffness={K} bounce={bounce} ghost={ghost ? B0 : undefined} tau={tau} active={active} />
        </motion.div>
      )}
    </div>
  )
}

function Pointer() {
  const x = useTrack((t) => ptr(t)[0])
  const y = useTrack((t) => ptr(t)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6) * (1 - ramp(t, 15.5, 15.9)))
  const press = useTrack((t) => 1 - 0.16 * Math.max(...CLICKS.map((c) => Math.sin(Math.PI * ramp(t, c - 0.08, c + 0.12, E.linear))), holding(t) ? 0.6 : 0))
  return <Cursor x={x} y={y} opacity={opacity} press={press} />
}

function Fade({ children }: { children: ReactNode }) {
  const opacity = useTrack((t) => (t < 1 ? kf(t, [[0, 0], [0.3, 1]]) : kf(t, [[DUR - 0.6, 1], [DUR, 0]])))
  return (
    <motion.div className="absolute inset-0" style={{ opacity }}>
      {children}
    </motion.div>
  )
}

export function UseCaseDesignAnimationsScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Chat />
        <Phone />
        <Panel />
        <Pointer />
      </Fade>
      <style>{`@keyframes da-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .da-caret { animation: da-caret 1s step-end infinite }
@keyframes da-pop { from { opacity: 0; transform: scale(.85) } } .da-pop { animation: da-pop .25s cubic-bezier(.22,1,.36,1) both }`}</style>
    </Scene>
  )
}

export default function UseCaseDesignAnimations() {
  return (
    <ScenePage label="Designers · Animations other tools can't do">
      <UseCaseDesignAnimationsScene />
    </ScenePage>
  )
}
