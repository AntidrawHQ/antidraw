/**
 * PMs · "Several implementations of one PRD": hand it the PRD, get three
 * takes built from the components already in your codebase.
 *
 * A free composition on a transparent stage, no app chrome:
 *   0.3–3s    The Savings goals PRD floats on the left; under it a small chat
 *             card, where the PM types "Three takes on this PRD, built with
 *             our components." and sends.
 *   3.3s      The team's components slide up in a tray (src/components/ui).
 *   4–7.8s    Three phones build one after another: copies of the tray's
 *             pieces fly up into each and the screen fills in behind them.
 *             The chat card shows the reads and crafts as they happen.
 *   8s        "Three takes, built only from your components."
 *   8.6–11s   The PM taps +$250 and Add money in GoalsFocus (the ring and
 *             total move) and picks "A trip" in GoalsStart. They're real.
 *   11s–      Held, then a fade through the loop seam.
 *
 * Pieces: usecase/design/chat.tsx (Reveal, ToolGroup/ToolRow, UserBubble,
 * AssistantText), thread.tsx (FileChip). Frames and the kit:
 * usecase/pm/goals.tsx.
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Cursor, E, Scene, ScenePage, Skeleton, kf, mix, path, ramp, typed, useAt, useTrack, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Reveal, ToolGroup, ToolRow, UserBubble } from "../usecase/design/chat"
import { FileChip } from "../usecase/design/thread"
import { FOCUS_ADD_AT, FOCUS_CHIP_AT, GOAL_H, GOAL_W, GoalsFocus, GoalsList, GoalsPrd, GoalsStart, KIT, PRD_H, PRD_W, START_TILE_AT } from "../usecase/pm/goals"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 14
const STILL = 12

const PRD_FILE = "savings-goals-prd.md"
const PROMPT = "Three takes on this PRD, built with our components."
const T = { type: [0.8, 2.5] as const, send: 2.95, tray: 3.3, reply: 8.0 }

/* ── Layout (stage px) ────────────────────────────────────────────────── */

const COL_X = 60
const COL_W = 300
const PRD_S = 0.75
const CHAT = { x: COL_X, y: 366, w: COL_W, h: 310 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]

const PS = 0.8
const PHONE_W = GOAL_W * PS
const PHONE_H = GOAL_H * PS
const PHONE_Y = 76
const PHONE_X = [400, 680, 960]
const phonePt = (i: number, [fx, fy]: readonly [number, number]): [number, number] => [PHONE_X[i] + fx * PS, PHONE_Y + fy * PS]

const TRAY = { x: 400, y: 604, w: 800, h: 80 }
const slotX = (k: number) => TRAY.x + 10 + 60 + k * 132
const SLOT_Y = TRAY.y + TRAY.h / 2

/* ── The tray's pieces, and which go where ────────────────────────────── */

const PIECES = KIT
const P = { button: 0, chip: 1, progress: 2, card: 3, row: 4, field: 5 }

/** Each take's build window. */
const BUILD = [4.0, 5.1, 6.2].map((b) => ({ at: b, fill: [b + 0.35, b + 1.5] as const }))
const NAMES = ["GoalsList", "GoalsFocus", "GoalsStart"]

/** Pieces flying from the tray into a take: piece, take, frame-px target, launch. */
const FLIGHTS: { p: number; i: number; to: [number, number]; t: number }[] = [
  { p: P.card, i: 0, to: [150, 166], t: BUILD[0].at + 0.05 },
  { p: P.progress, i: 0, to: [150, 280], t: BUILD[0].at + 0.25 },
  { p: P.button, i: 0, to: [150, 490], t: BUILD[0].at + 0.45 },
  { p: P.chip, i: 1, to: [150, 337], t: BUILD[1].at + 0.05 },
  { p: P.button, i: 1, to: [150, 390], t: BUILD[1].at + 0.25 },
  { p: P.row, i: 1, to: [150, 478], t: BUILD[1].at + 0.45 },
  { p: P.card, i: 2, to: [84, 222], t: BUILD[2].at + 0.05 },
  { p: P.field, i: 2, to: [150, 420], t: BUILD[2].at + 0.25 },
  { p: P.button, i: 2, to: [150, 542], t: BUILD[2].at + 0.45 },
]
const FLY = 0.75

/** Chat card rows, each [start, done]. */
const ROWS = [
  { title: `Read ${PRD_FILE}`, start: 3.2, done: 3.6 },
  { title: "Read src/components/ui", start: 3.6, done: 4.0 },
  ...NAMES.map((n, i) => ({ title: `Crafting ${n}`, start: BUILD[i].at, done: BUILD[i].fill[1] + 0.1 })),
]

/** The PM's taps in the takes. */
const CLICK = { chip: 9.0, add: 9.65, tile: 10.6 }
const ADD = [CLICK.add + 0.05, CLICK.add + 0.75] as const

const YOU: PathKey[] = [
  [0, 300, 560],
  [T.send - 0.55, 300, 560],
  [T.send - 0.1, ...SEND_AT, E.inOut],
  [T.send + 0.4, ...SEND_AT],
  [4.6, 360, 300, E.inOut],
  [8.4, 380, 290],
  [CLICK.chip - 0.1, ...phonePt(1, FOCUS_CHIP_AT(2)), E.inOut],
  [CLICK.chip + 0.25, ...phonePt(1, FOCUS_CHIP_AT(2))],
  [CLICK.add - 0.1, ...phonePt(1, FOCUS_ADD_AT), E.inOut],
  [CLICK.add + 0.3, ...phonePt(1, FOCUS_ADD_AT)],
  [CLICK.tile - 0.1, ...phonePt(2, START_TILE_AT(0)), E.inOut],
  [CLICK.tile + 0.4, ...phonePt(2, START_TILE_AT(0))],
  [11.6, 1150, 640, E.inOut],
  [DUR, 1150, 640],
]
const CLICKS = [T.send, CLICK.chip, CLICK.add, CLICK.tile]

/* ── Pieces of the composition ────────────────────────────────────────── */

function Prd() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.5))
  const y = useTrack((t) => kf(t, [[0.1, 14], [0.6, 0, E.out]]))
  return (
    <motion.div className="absolute" style={{ left: COL_X + (COL_W - PRD_W * PRD_S) / 2, top: 50, opacity, y, rotate: -2 }}>
      <div className="origin-top-left" style={{ width: PRD_W, height: PRD_H, scale: PRD_S }}>
        <GoalsPrd />
      </div>
    </motion.div>
  )
}

function Chat() {
  const opacity = useTrack((t) => ramp(t, 0.2, 0.6))
  const typing = useAt((t) => t < T.send)
  const n = useAt((t) => typed(t, T.type[0], T.type[1], PROMPT))
  const press = useAt((t) => Math.round(Math.sin(Math.PI * ramp(t, T.send - 0.08, T.send + 0.12, E.linear)) * 10) / 10)
  const sent = useAt((t) => t >= T.send + 0.1)
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
            <div className="pb-1">
              <FileChip name={PRD_FILE} />
            </div>
            <UserBubble className="[&>div]:max-w-[92%]">{PROMPT}</UserBubble>
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
          <AssistantText>Three takes, built only from your components. Nothing new to maintain.</AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 shadow-xs">
        {typing && n > 0 && <FileChip name={PRD_FILE} className="ppt-pop" />}
        <div className="mt-1.5 pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {typing ? PROMPT.slice(0, n) : ""}
          {typing && <span className="ppt-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
          {!typing && <span className="text-neutral-400">Ask me anything...</span>}
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

function Tray() {
  const y = useTrack((t) => kf(t, [[T.tray, 30], [T.tray + 0.5, 0, E.out]]))
  const opacity = useTrack((t) => ramp(t, T.tray, T.tray + 0.35))
  return (
    <motion.div className="absolute font-sans" style={{ left: TRAY.x, top: TRAY.y - 22, width: TRAY.w, y, opacity }}>
      <div className="mb-1.5 flex items-baseline gap-2 pl-1 text-[11px]">
        <span className="font-medium text-white/70">Your components</span>
      </div>
      <div className="relative rounded-[14px] border border-black/5 shadow-[0_8px_20px_-10px_rgba(0,0,0,0.3)]" style={{ height: TRAY.h, background: "#effcd2", color: "#0d4a12" }}>
        {PIECES.map((p, k) => (
          <div key={p.name} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: slotX(k) - TRAY.x }}>
            <div style={{ scale: PS }}>{p.el}</div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

function Ghost({ p, i, to, t: t0 }: (typeof FLIGHTS)[number]) {
  const [tx, ty] = phonePt(i, to)
  const pos = (t: number): [number, number] => {
    const k = ramp(t, t0, t0 + FLY, E.inOut)
    const lift = Math.sin(Math.PI * k) * 70
    return [mix(slotX(p), tx, k), mix(SLOT_Y, ty, k) - lift]
  }
  const x = useTrack((t) => pos(t)[0])
  const y = useTrack((t) => pos(t)[1])
  const opacity = useTrack((t) => kf(t, [[t0, 0], [t0 + 0.1, 1], [t0 + FLY - 0.05, 1], [t0 + FLY + 0.2, 0]]))
  const scale = useTrack((t) => kf(t, [[t0, PS], [t0 + FLY / 2, PS * 1.12, E.out], [t0 + FLY, PS, E.inOut]]))
  const shown = useAt((t) => t >= t0 && t < t0 + FLY + 0.25)
  if (!shown) return null
  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-20 font-sans" style={{ x, y, opacity }}>
      <motion.div className="-translate-x-1/2 -translate-y-1/2 drop-shadow-[0_10px_18px_rgba(0,0,0,0.35)]" style={{ scale, color: "#0d4a12" }}>
        {PIECES[p].el}
      </motion.div>
    </motion.div>
  )
}

function Phone({ i, children }: { i: number; children: ReactNode }) {
  const b = BUILD[i]
  const opacity = useTrack((t) => ramp(t, b.at - 0.1, b.at + 0.2))
  const scale = useTrack((t) => kf(t, [[b.at - 0.1, 0.94], [b.at + 0.45, 1, E.pop]]))
  const clipPath = useTrack((t) => `inset(0 0 ${(1 - ramp(t, b.fill[0], b.fill[1], E.inOut)) * 100}% 0)`)
  const shown = useAt((t) => t >= b.at - 0.1)
  if (!shown) return null
  return (
    <motion.div className="absolute font-sans" style={{ left: PHONE_X[i], top: PHONE_Y - 20, width: PHONE_W, opacity, scale }}>
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">{NAMES[i]}</div>
      <div className="relative overflow-hidden rounded-[18px] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.08]" style={{ height: PHONE_H }}>
        <Skeleton />
        <motion.div className="absolute inset-0" style={{ clipPath }}>
          <div className="relative origin-top-left" style={{ width: GOAL_W, height: GOAL_H, scale: PS }}>
            {children}
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}

function Focus() {
  const chip = useAt((t) => (t >= CLICK.chip && t < ADD[1] + 0.6 ? 2 : -1))
  const added = useAt((t) => Math.round(ramp(t, ADD[0], ADD[1], E.out) * 250))
  return <GoalsFocus chip={chip} added={added} />
}

function Start() {
  const pick = useAt((t) => (t >= CLICK.tile ? 0 : -1))
  return <GoalsStart pick={pick} />
}

function Pointer() {
  const x = useTrack((t) => path(t, YOU)[0])
  const y = useTrack((t) => path(t, YOU)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6) * (1 - ramp(t, 11.8, 12.2)))
  const press = useTrack((t) => 1 - 0.16 * Math.max(...CLICKS.map((c) => Math.sin(Math.PI * ramp(t, c - 0.08, c + 0.12, E.linear)))))
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

export function UseCasePMPrdTakesScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Prd />
        <Chat />
        <Tray />
        <Phone i={0}>
          <GoalsList />
        </Phone>
        <Phone i={1}>
          <Focus />
        </Phone>
        <Phone i={2}>
          <Start />
        </Phone>
        {FLIGHTS.map((f, k) => (
          <Ghost key={k} {...f} />
        ))}
        <Pointer />
      </Fade>
      <style>{`@keyframes ppt-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .ppt-caret { animation: ppt-caret 1s step-end infinite }
@keyframes ppt-pop { from { opacity: 0; transform: scale(.85) } } .ppt-pop { animation: ppt-pop .25s cubic-bezier(.22,1,.36,1) both }`}</style>
    </Scene>
  )
}

export default function UseCasePMPrdTakes() {
  return (
    <ScenePage label="PMs · Several implementations of one PRD">
      <UseCasePMPrdTakesScene />
    </ScenePage>
  )
}
