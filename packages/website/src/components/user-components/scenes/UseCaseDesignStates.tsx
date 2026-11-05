/**
 * Designers · "Design every state": hover, loading, empty, error, the
 * 40-character name and the three-line title, flipped through on the real
 * component instead of drawn one by one.
 *
 * Same language as UseCasePMRealData, on a transparent stage:
 *   0–3.2s     MemberList (the members card from Whitlock's settings page) is
 *              on the canvas in its one happy state. The designer selects it
 *              and asks: "Show me every state this can be in."
 *   3.4–5.6s   The agent reads the component and adds the states. A state bar
 *              slides in on top of the card (the frame grows to fit it).
 *   6s         The reply.
 *   6.8–12.6s  The designer flips through them on the one live card: Hover
 *              (Tomás's row lights up, its menu appears), Loading (rows melt
 *              into a shimmering skeleton), Empty (an invite prompt), Error
 *              (a retry), Long text (row one becomes a 40-character name that
 *              truncates and a title that wraps to three lines, pushing the
 *              rows below down).
 *   13.6–14.9s All states: the frame opens out, the card shrinks into the middle
 *              and the other five deal out from under it: six live instances
 *              side by side, one per state.
 *   15s–       Held, then a fade through the loop seam.
 *
 * Pieces: usecase/design/chat.tsx. Card and state bar:
 * usecase/design/memberstates.tsx.
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { BLUE, Cursor, E, Scene, ScenePage, kf, mix, path, ramp, typed, useAt, useTrack, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Chip, Reveal, ToolGroup, ToolRow, UserBubble } from "../usecase/design/chat"
import { BAR_H, BAR_W, CARD_H, CARD_W, INK, MemberList, PAPER, PILL_AT, STATES, STATE_PROPS, StateBar } from "../usecase/design/memberstates"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 17.5
const STILL = 16

const PROMPT = "Show me every state this can be in."
const T = { select: 0.9, type: [1.5, 2.8] as const, send: 3.15, reply: 6.0 }

const ROWS = [
  { title: "Read MemberList.tsx", start: 3.4, done: 3.9 },
  { title: "Adding the missing states", start: 3.9, done: 5.0 },
  { title: "Check a 40-character name", start: 5.0, done: 5.6 },
]
const BAR_IN = [4.9, 5.5] as const

/** When the designer clicks each pill: Hover … Long text, then All states. */
const PICK = [6.8, 8.1, 9.4, 10.7, 12.0]
const ALL = 13.6
/** All states: the card shrinks to a cell in the middle, then the others deal out from under it. */
const FAN = [13.75, 14.6] as const
const SHRINK = [13.75, 14.2] as const
const SPREAD = [14.0, 14.9] as const

/* ── Layout ───────────────────────────────────────────────────────────── */

const CHAT = { x: 72, y: 116, w: 300, h: 529 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]
const INPUT_AT: [number, number] = [CHAT.x + 120, CHAT.y + CHAT.h - 56]

type Box = { x: number; y: number; w: number; h: number }
const PAD = 28
const BAR_TOP = 15
const BAR_SPACE = 36
/** The frame: before the bar, with it, and opened out for All states. */
const FR0: Box = { x: 560, y: 163, w: CARD_W + 2 * 60, h: PAD + CARD_H + PAD }
const FR1: Box = { ...FR0, h: FR0.h + BAR_SPACE }
const GS = 0.56
const CW = CARD_W * GS
const CH = CARD_H * GS
const LABEL_H = 20
const GX = 36
const GY = 14
const GRID_TOP = BAR_TOP + BAR_H + 16
const FR2: Box = { x: 420, y: 0, w: 800, h: GRID_TOP + 2 * (LABEL_H + CH) + GY + 22 }
FR2.y = Math.round(381 - FR2.h / 2)

const lerpBox = (a: Box, b: Box, p: number): Box => ({ x: mix(a.x, b.x, p), y: mix(a.y, b.y, p), w: mix(a.w, b.w, p), h: mix(a.h, b.h, p) })
const barP = (t: number) => ramp(t, BAR_IN[0], BAR_IN[1], E.inOut)
const fanP = (t: number) => ramp(t, FAN[0], FAN[1], E.inOut)
const frame = (t: number) => lerpBox(lerpBox(FR0, FR1, barP(t)), FR2, fanP(t))

/** Where the one card sits in the frame, and where cell i sits in the grid (stage px). */
const single = (t: number): [number, number] => {
  const f = lerpBox(FR0, FR1, barP(t))
  return [f.x + (f.w - CARD_W) / 2, f.y + PAD + BAR_SPACE * barP(t)]
}
const cell = (i: number): [number, number] => {
  const used = 3 * CW + 2 * GX
  return [FR2.x + (FR2.w - used) / 2 + (i % 3) * (CW + GX), FR2.y + GRID_TOP + Math.floor(i / 3) * (LABEL_H + CH + GY) + LABEL_H]
}
/** Just under a pill's label, so the arrow doesn't cover it. */
/** The middle of the grid, where the card shrinks to before the others spread out. */
const MID: [number, number] = [FR2.x + (FR2.w - CW) / 2, FR2.y + GRID_TOP + (2 * (LABEL_H + CH) + GY - CH) / 2]
const pill = (i: number): [number, number] => [FR1.x + FR1.w / 2 - BAR_W / 2 + PILL_AT(i)[0] + 6, FR1.y + BAR_TOP + PILL_AT(i)[1] + 7]

/* ── The pointer ──────────────────────────────────────────────────────── */

const REST: [number, number] = [1010, 668]
const YOU: PathKey[] = [
  [0, ...REST],
  [T.select - 0.5, ...REST],
  [T.select - 0.05, 790, 330, E.inOut],
  [T.select + 0.15, 790, 330],
  [T.type[0] - 0.05, ...INPUT_AT, E.inOut],
  [T.send - 0.45, ...INPUT_AT],
  [T.send - 0.08, ...SEND_AT, E.inOut],
  [T.send + 0.35, ...SEND_AT],
  [4.6, 640, 662, E.inOut],
  [PICK[0] - 0.75, 640, 662],
  ...PICK.flatMap((at, i): PathKey[] => [
    [at - 0.08, ...pill(i + 1), E.inOut],
    [at + 0.35, ...pill(i + 1)],
  ]),
  [ALL - 0.08, ...pill(6), E.inOut],
  [ALL + 0.3, ...pill(6)],
  [14.9, 1150, 690, E.inOut],
  [DUR, 1150, 690],
]
const CLICKS = [T.select, T.send, ...PICK, ALL]

/* ── The states, over time ────────────────────────────────────────────── */

/** The bar's thumb: glides to each pill as it's clicked. */
const thumb = (t: number) => kf(t, [[0, 0], ...[...PICK, ALL].flatMap((at, i): [number, number, typeof E.out][] => [[at, i, E.out], [at + 0.28, i + 1, E.out]])])
const into = (t: number, i: number) => ramp(t, PICK[i], PICK[i] + 0.35, E.out)
const outOf = (t: number, i: number) => ramp(t, PICK[i], PICK[i] + 0.22, E.linear)
const q = (v: number) => Math.round(v * 40) / 40

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Chat() {
  const opacity = useTrack((t) => ramp(t, 0.2, 0.6))
  const typing = useAt((t) => t < T.send)
  const n = useAt((t) => typed(t, T.type[0], T.type[1], PROMPT))
  const press = useAt((t) => Math.round(Math.sin(Math.PI * ramp(t, T.send - 0.08, T.send + 0.12, E.linear)) * 10) / 10)
  const sent = useAt((t) => t >= T.send + 0.1)
  const chip = useAt((t) => t >= T.select + 0.05 && t < T.send)
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
          <UserBubble className="[&>div]:max-w-[92%]" tags={[{ frame: "MemberList" }]}>
            {PROMPT}
          </UserBubble>
        </Reveal>
        <Reveal on={shown > 0}>
          <ToolGroup>
            {ROWS.slice(0, Math.max(1, shown)).map((r, i) => (
              <ToolRow key={i} title={r.title} running={i >= finished} />
            ))}
          </ToolGroup>
        </Reveal>
        <Reveal on={reply}>
          <AssistantText>MemberList has a state bar now: hover, loading, empty, error and long text, all on the real component, plus every state side by side. Flip through them.</AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 min-h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 pb-11 shadow-xs">
        {chip && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <Chip frame="MemberList" className="ds-pop" />
          </div>
        )}
        <div className="pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {typing && n > 0 ? PROMPT.slice(0, n) : <span className="text-neutral-400">Ask me anything...</span>}
          {typing && n > 0 && <span className="ds-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
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

/** The component's frame on the canvas: grows for the bar, opens out for the grid. */
function Frame() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const left = useTrack((t) => frame(t).x)
  const top = useTrack((t) => frame(t).y)
  const width = useTrack((t) => frame(t).w)
  const height = useTrack((t) => frame(t).h)
  const labelY = useTrack((t) => frame(t).y - 22)
  const selected = useAt((t) => t >= T.select && t < T.send)
  return (
    <motion.div className="absolute inset-0" style={{ opacity }}>
      <motion.div className="absolute font-sans text-[11.5px] font-medium text-white/55" style={{ left, top: labelY }}>
        MemberList
      </motion.div>
      <motion.div className="absolute rounded-[14px] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.08]" style={{ left, top, width, height, background: PAPER }} />
      <motion.div className="pointer-events-none absolute rounded-[14px] transition-opacity duration-200" style={{ left, top, width, height, boxShadow: `0 0 0 1.5px ${BLUE}`, opacity: selected ? 1 : 0 }} />
    </motion.div>
  )
}

function Bar() {
  const shown = useAt((t) => t >= BAR_IN[0])
  const x = useTrack((t) => frame(t).x + frame(t).w / 2 - BAR_W / 2)
  const y = useTrack((t) => frame(t).y + BAR_TOP - 8 * (1 - barP(t)))
  const opacity = useTrack((t) => ramp(t, BAR_IN[0] + 0.15, BAR_IN[1]))
  const at = useAt((t) => q(thumb(t)))
  if (!shown) return null
  return (
    <motion.div className="absolute top-0 left-0" style={{ x, y, opacity }}>
      <StateBar at={at} />
    </motion.div>
  )
}

/** The one live card: every state plays on it, then it becomes the Long text cell. */
function Live() {
  const at = (t: number, k: 0 | 1) => mix(mix(single(t)[k], MID[k], ramp(t, SHRINK[0], SHRINK[1], E.inOut)), cell(5)[k], ramp(t, SPREAD[0], SPREAD[1], E.inOut))
  const x = useTrack((t) => at(t, 0))
  const y = useTrack((t) => at(t, 1))
  const scale = useTrack((t) => mix(1, GS, ramp(t, SHRINK[0], SHRINK[1], E.inOut)))
  const hover = useAt((t) => q(into(t, 0) * (1 - outOf(t, 1))))
  const rows = useAt((t) => q(Math.max(1 - outOf(t, 1), into(t, 4))))
  const loading = useAt((t) => q(into(t, 1) * (1 - outOf(t, 2))))
  const empty = useAt((t) => q(into(t, 2) * (1 - outOf(t, 3))))
  const error = useAt((t) => q(into(t, 3) * (1 - outOf(t, 4))))
  const long = useAt((t) => q(ramp(t, PICK[4] + 0.15, PICK[4] + 0.75, E.inOut)))
  return (
    <motion.div className="absolute top-0 left-0 z-10 origin-top-left" style={{ x, y, scale }}>
      <MemberList layers={{ rows, loading, empty, error }} hover={hover} long={long} />
    </motion.div>
  )
}

/** One of the other five states, fanning out of the live card into its cell. */
function Instance({ i }: { i: number }) {
  const shown = useAt((t) => t >= SPREAD[0])
  const p = (t: number) => ramp(t, SPREAD[0] + i * 0.03, SPREAD[1] + i * 0.03 - 0.15, E.inOut)
  const x = useTrack((t) => mix(MID[0], cell(i)[0], p(t)))
  const y = useTrack((t) => mix(MID[1], cell(i)[1], p(t)))
  const opacity = useTrack((t) => ramp(t, SPREAD[0], SPREAD[0] + 0.25))
  if (!shown) return null
  return (
    <motion.div className="absolute top-0 left-0 origin-top-left" style={{ x, y, scale: GS, opacity }}>
      <MemberList {...STATE_PROPS[i]} />
    </motion.div>
  )
}

/** The state names over the grid cells. */
function Labels() {
  const opacity = useTrack((t) => ramp(t, SPREAD[1] - 0.25, SPREAD[1] + 0.2))
  return (
    <motion.div className="absolute inset-0 font-sans" style={{ opacity }}>
      {STATES.map((s, i) => {
        const [x, y] = cell(i)
        return (
          <span key={s} className="absolute text-[11.5px] font-medium" style={{ left: x + 1, top: y - LABEL_H + 1, color: INK, opacity: 0.6 }}>
            {s}
          </span>
        )
      })}
    </motion.div>
  )
}

function Pointer() {
  const x = useTrack((t) => path(t, YOU)[0])
  const y = useTrack((t) => path(t, YOU)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6) * (1 - ramp(t, 15.3, 15.7)))
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

export function UseCaseDesignStatesScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Chat />
        <Frame />
        <Bar />
        {[0, 1, 2, 3, 4].map((i) => (
          <Instance key={i} i={i} />
        ))}
        <Live />
        <Labels />
        <Pointer />
      </Fade>
      <style>{`@keyframes ds-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .ds-caret { animation: ds-caret 1s step-end infinite }
@keyframes ds-pop { from { opacity: 0; transform: scale(.85) } } .ds-pop { animation: ds-pop .25s cubic-bezier(.22,1,.36,1) both }`}</style>
    </Scene>
  )
}

export default function UseCaseDesignStates() {
  return (
    <ScenePage label="Designers · Design every state">
      <UseCaseDesignStatesScene />
    </ScenePage>
  )
}
