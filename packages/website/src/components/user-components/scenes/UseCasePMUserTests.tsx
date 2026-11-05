/**
 * PMs · "Test it with users": research sessions on a prototype that behaves
 * like the product, changed between sessions.
 *
 * Same language as UseCasePMRealData, on a transparent stage:
 *   0.5–4.4s   Session 1. A tester (their taps shown as a touch dot) is asked
 *              to set up a goal for a $1,500 trip in GoalFlow. They pick A
 *              trip, Continue, then tap the amount twice to type $1,500;
 *              nothing happens (the dead taps leave orange marks), so they
 *              settle for the $2,000 chip. Timestamped notes land in the
 *              test doc; the session closes "Stuck on amount".
 *   4.6–8.4s   The PM selects GoalFlow and asks: make the amount editable,
 *              keep the chips. The agent edits GoalAmount; the phone's amount
 *              turns into a field, flashed as it lands. The reply.
 *   8.8–14.7s  Session 2, on the changed flow. The tester taps the amount, a
 *              number pad slides up, they type 1500, Done, Continue (Review
 *              rises as a sheet), Create goal (spinner, then the done
 *              screen). The doc closes it "Done in 0:14".
 *   15s–       Held, then a fade through the loop seam.
 *
 * Pieces: usecase/design/chat.tsx. Screens: usecase/pm/goals.tsx
 * (GoalsStart), usecase/pm/goalflow.tsx, usecase/pm/goaltest.tsx.
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { BLUE, Cursor, E, Scene, ScenePage, kf, path, ramp, typed, useAt, useTrack, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Chip, Reveal, ToolGroup, ToolRow, UserBubble } from "../usecase/design/chat"
import { GOAL_H, GOAL_W, GoalsStart, START_TILE_AT } from "../usecase/pm/goals"
import { FLOW_AMOUNT_AT, FLOW_CREATE_AT, FLOW_NEXT_AT, GoalAmount, GoalDone, GoalReview, REVIEW_SHEET_Y } from "../usecase/pm/goalflow"
import { FIELD_AT, GoalAmountEdit, KEY_AT, NOTES_H, OLD_AMOUNT_AT, PAD_DONE_AT, ResearchNotes, type Session } from "../usecase/pm/goaltest"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 18
const STILL = 15.6

/* ── Timeline ─────────────────────────────────────────────────────────── */

// Session 1: the old amount screen.
const S1 = { live: [0.5, 4.4] as const, trip: 0.95, next: 1.45, dead: [2.35, 2.8], chip: 3.5 }
const SLIDE1 = [1.5, 1.85] as const

// Between sessions: the ask and the fix.
const PROMPT = "Alex tried to tap the amount and type $1,500. Make the amount editable, and keep the chips as shortcuts."
const T = { select: 4.85, type: [5.25, 6.75] as const, send: 7.0, reply: 8.4 }
const ROWS = [
  { title: "Read GoalAmount.tsx", start: 7.2, done: 7.5 },
  { title: "Editing GoalAmount", start: 7.5, done: 8.3 },
]
const EDIT = [7.75, 8.0] as const
const FLASH = [7.9, 8.15, 8.7] as const
const RESET = [8.75, 9.0] as const

// Session 2: the new one.
const S2 = { live: [9.0, 14.7] as const, trip: 9.35, next: 9.8, field: 10.5, keys: [10.95, 11.15, 11.35, 11.55], done: 11.9, next2: 12.45, create: 13.25 }
const SLIDE2 = [9.85, 10.2] as const
const PAD = [10.55, 10.85] as const
const PAD_OUT = [11.95, 12.2] as const
const SHEET = [12.5, 13.05] as const
const COLLAPSE = [13.3, 13.6] as const
const REVEAL = [14.0, 14.35] as const
const DONE = [14.25, 15.15] as const

const SESSIONS: Session[] = [
  {
    name: "Session 1",
    who: "Alex",
    notes: [
      { at: "0:02", text: "Picks A trip straight away" },
      { at: "0:09", text: "Taps the amount twice, trying to type $1,500. Nothing happens" },
      { at: "0:15", text: "Settles for the $2,000 chip" },
    ],
    outcome: { label: "Stuck on amount", good: false },
  },
  {
    name: "Session 2",
    who: "Sam",
    notes: [
      { at: "0:02", text: "Picks A trip" },
      { at: "0:07", text: "Taps the amount and types $1,500" },
      { at: "0:14", text: "Goal set, no help needed" },
    ],
    outcome: { label: "Done in 0:14", good: true },
  },
]
const NOTE_AT = [
  [1.05, 2.95, 3.8],
  [9.45, 11.7, 14.5],
]
const OUTCOME_AT = [4.4, 14.7]

/* ── Layout ───────────────────────────────────────────────────────────── */

const CHAT = { x: 72, y: 96, w: 300, h: 570 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]
const INPUT_AT: [number, number] = [CHAT.x + 120, CHAT.y + CHAT.h - 56]

const PS = 0.95
const PHONE = { x: 412, y: 96, w: GOAL_W * PS, h: GOAL_H * PS }
const phonePt = ([fx, fy]: readonly [number, number]): [number, number] => [PHONE.x + fx * PS, PHONE.y + fy * PS]

const NOTES = { x: 737, y: 381 - NOTES_H / 2 }

/* ── The tester's taps ────────────────────────────────────────────────── */

type Tap = { at: number; pt: [number, number]; dead?: boolean }
const DEAD_PTS: [number, number][] = [OLD_AMOUNT_AT, [OLD_AMOUNT_AT[0] + 16, OLD_AMOUNT_AT[1] + 6]]
const TAPS: Tap[] = [
  { at: S1.trip, pt: START_TILE_AT(0) },
  { at: S1.next, pt: FLOW_NEXT_AT },
  { at: S1.dead[0], pt: DEAD_PTS[0], dead: true },
  { at: S1.dead[1], pt: DEAD_PTS[1], dead: true },
  { at: S1.chip, pt: FLOW_AMOUNT_AT(2) },
  { at: S2.trip, pt: START_TILE_AT(0) },
  { at: S2.next, pt: FLOW_NEXT_AT },
  { at: S2.field, pt: FIELD_AT },
  ...["1", "5", "0", "0"].map((k, i) => ({ at: S2.keys[i], pt: KEY_AT(k) })),
  { at: S2.done, pt: PAD_DONE_AT },
  { at: S2.next2, pt: FLOW_NEXT_AT },
  { at: S2.create, pt: FLOW_CREATE_AT },
]

/** The touch dot's path, in stage px: it rests between taps, arrives just before each. */
const TOUCH: PathKey[] = (() => {
  const keys: PathKey[] = [[0, ...phonePt([226, 430])], [S1.live[0], ...phonePt([226, 430])]]
  for (const [i, tap] of TAPS.entries()) {
    if (i === 5) keys.push([S2.live[0] - 0.01, ...phonePt([226, 430])], [S2.live[0] + 0.1, ...phonePt([226, 430])])
    if (i === 4) keys.push([3.15, ...phonePt([110, 296]), E.inOut])
    keys.push([tap.at - 0.06, ...phonePt(tap.pt), E.inOut], [tap.at + 0.1, ...phonePt(tap.pt)])
  }
  keys.push([DUR, ...phonePt(FLOW_CREATE_AT)])
  return keys
})()

/** The PM's pointer, only between sessions. */
const YOU: PathKey[] = [
  [0, 760, 690],
  [4.45, 760, 690],
  [T.select - 0.05, ...phonePt([150, 300]), E.inOut],
  [T.select + 0.12, ...phonePt([150, 300])],
  [T.type[0] - 0.1, ...INPUT_AT, E.inOut],
  [T.send - 0.45, ...INPUT_AT],
  [T.send - 0.08, ...SEND_AT, E.inOut],
  [T.send + 0.3, ...SEND_AT],
  [7.9, 650, 690, E.inOut],
  [DUR, 650, 690],
]
const CLICKS = [T.select, T.send]

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
          <UserBubble className="[&>div]:max-w-[92%]" tags={[{ frame: "GoalFlow" }]}>
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
          <AssistantText>The amount is a field now: tap it and the number pad opens, and the chips still fill it in. Ready for the next session.</AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 min-h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 pb-11 shadow-xs">
        {chip && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <Chip frame="GoalFlow" className="ut-pop" />
          </div>
        )}
        <div className="pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {typing && n > 0 ? PROMPT.slice(0, n) : <span className="text-neutral-400">Ask me anything...</span>}
          {typing && n > 0 && <span className="ut-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
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

function Notes() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const s1 = useAt((t) => NOTE_AT[0].filter((a) => t >= a).length)
  const s2 = useAt((t) => NOTE_AT[1].filter((a) => t >= a).length)
  const o1 = useAt((t) => t >= OUTCOME_AT[0])
  const o2 = useAt((t) => t >= OUTCOME_AT[1])
  const live = useAt((t) => (t >= S1.live[0] && t < S1.live[1] ? 0 : t >= S2.live[0] && t < S2.live[1] ? 1 : -1))
  return (
    <motion.div className="absolute" style={{ left: NOTES.x, top: NOTES.y, opacity }}>
      <ResearchNotes sessions={SESSIONS} shown={[s1, s2]} outcome={[o1, o2]} live={live} />
    </motion.div>
  )
}

/** A screen at frame size, scaled. */
const Fit = ({ s, children }: { s: number; children: ReactNode }) => (
  <div className="relative origin-top-left" style={{ width: GOAL_W, height: GOAL_H, scale: s }}>
    {children}
  </div>
)

const slide = (t: number) => Math.max(ramp(t, SLIDE1[0], SLIDE1[1], E.inOut) * (t < RESET[0] ? 1 : 0), ramp(t, SLIDE2[0], SLIDE2[1], E.inOut))
const amountKey = (t: number) => {
  const k = S2.keys.filter((a) => t >= a).length
  return [0, 1, 15, 150, 1500][k]
}

function Phone() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const selected = useAt((t) => t >= T.select && t < T.send)
  // Start ⇄ Amount: Amount slides in from the right, Start drifts left and dims.
  const startX = useTrack((t) => `${-30 * slide(t)}%`)
  const startDim = useTrack((t) => 0.25 * slide(t))
  const amountX = useTrack((t) => `${100 * (1 - slide(t))}%`)
  const resetOp = useTrack((t) => (t >= RESET[0] && t < SLIDE2[0] ? ramp(t, RESET[0], RESET[1]) : 1))
  const startOn = useAt((t) => t < SLIDE1[1] || (t >= RESET[0] && t < SLIDE2[1]))
  const amountOn = useAt((t) => (t >= SLIDE1[0] && t < RESET[1]) || (t >= SLIDE2[0] && t < REVEAL[1]))
  const pick = useAt((t) => (t >= S2.trip || (t >= S1.trip && t < RESET[0]) ? 0 : -1))
  // The old amount screen, then the edited one.
  const oldOn = useAt((t) => t < EDIT[1])
  const editOp = useTrack((t) => ramp(t, EDIT[0], EDIT[1]))
  const oldAmount = useAt((t) => Math.round(1000 + 1000 * ramp(t, S1.chip + 0.05, S1.chip + 0.5, E.out)))
  const oldChip = useAt((t) => (t >= S1.chip ? 2 : 1))
  const flash = useAt((t) => Math.round(kf(t, [[FLASH[0], 0], [FLASH[1], 1], [FLASH[2], 0]]) * 20) / 20)
  const focus = useAt((t) => t >= S2.field && t < S2.done)
  const pad = useAt((t) => Math.round((ramp(t, PAD[0], PAD[1], E.out) - ramp(t, PAD_OUT[0], PAD_OUT[1], E.inOut)) * 30) / 30)
  const amount = useAt((t) => (t >= S2.field ? amountKey(t) : 1000))
  const chip = useAt((t) => (t >= S2.field ? -1 : 1))
  // Amount → Review → Done, as in UseCasePMClickFlows.
  const sheetOn = useAt((t) => t >= SHEET[0] && t < REVEAL[1] + 0.2)
  const sheetY = useTrack((t) => (1 - ramp(t, SHEET[0], SHEET[1], E.out)) * PHONE.h + REVIEW_SHEET_Y * PS)
  const backScale = useTrack((t) => (t >= SLIDE2[0] ? 1 - 0.07 * ramp(t, SHEET[0], SHEET[1], E.out) : 1))
  const backRadius = useTrack((t) => (t >= SLIDE2[0] ? 22 * ramp(t, SHEET[0], SHEET[1], E.out) : 0))
  const scrim = useTrack((t) => (t >= SLIDE2[0] ? 0.35 * ramp(t, SHEET[0], SHEET[1], E.out) : 0))
  const collapse = useAt((t) => Math.round(ramp(t, COLLAPSE[0], COLLAPSE[1], E.inOut) * 30) / 30)
  const doneOn = useAt((t) => t >= REVEAL[0])
  const doneOp = useTrack((t) => ramp(t, REVEAL[0], REVEAL[1]))
  const done = useAt((t) => Math.round(ramp(t, DONE[0], DONE[1], E.linear) * 40) / 40)
  const deadMarks = useAt((t) => (t >= EDIT[0] ? 0 : TAPS.filter((p) => p.dead && t >= p.at).length))
  const testing = useAt((t) => (t >= S1.live[0] && t < S1.live[1] ? "Alex" : t >= S2.live[0] && t < S2.live[1] ? "Sam" : ""))
  return (
    <motion.div className="absolute font-sans" style={{ left: PHONE.x, top: PHONE.y - 22, width: PHONE.w, opacity }}>
      <div className="mb-1.5 flex items-center justify-between px-0.5 text-[11.5px] font-medium text-white/55">
        GoalFlow
        {testing && (
          <span className="ut-pop flex items-center gap-1.5 text-white/70">
            <span className="ut-live size-[6px] rounded-full bg-[#ff5c5c]" />
            Testing with {testing}
          </span>
        )}
      </div>
      <div className="relative overflow-hidden rounded-[22px] bg-[#effcd2] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.08]" style={{ height: PHONE.h }}>
        {amountOn && (
          <motion.div className="absolute inset-0 origin-top overflow-hidden" style={{ x: amountX, scale: backScale, borderRadius: backRadius }}>
            {oldOn && (
              <div className="absolute inset-0">
                <Fit s={PS}>
                  <GoalAmount amount={oldAmount} chip={oldChip} />
                </Fit>
              </div>
            )}
            <motion.div className="absolute inset-0" style={{ opacity: editOp }}>
              <Fit s={PS}>
                <GoalAmountEdit amount={amount} chip={chip} focus={focus} pad={pad} flash={flash} />
              </Fit>
            </motion.div>
            {DEAD_PTS.slice(0, deadMarks).map(([fx, fy], i) => (
              <span key={i} className="ut-pop absolute size-[14px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#ff7a1a] bg-[#ff7a1a]/30" style={{ left: fx * PS, top: fy * PS }} />
            ))}
            <motion.div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: scrim }} />
          </motion.div>
        )}
        {startOn && (
          <motion.div className="absolute inset-0" style={{ x: startX, opacity: resetOp }}>
            <Fit s={PS}>
              <GoalsStart pick={pick} />
            </Fit>
            <motion.div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: startDim }} />
          </motion.div>
        )}
        {sheetOn && (
          <motion.div className="absolute inset-0 overflow-hidden rounded-t-[22px] shadow-[0_-10px_30px_rgba(0,0,0,0.25)]" style={{ y: sheetY }}>
            <Fit s={PS}>
              <GoalReview sheet collapse={collapse} amount={1500} />
            </Fit>
          </motion.div>
        )}
        {doneOn && (
          <motion.div className="absolute inset-0" style={{ opacity: doneOp }}>
            <Fit s={PS}>
              <GoalDone p={done} amount={1500} />
            </Fit>
          </motion.div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-[22px] transition-opacity duration-200" style={{ top: 22, boxShadow: `0 0 0 1.5px ${BLUE}`, opacity: selected ? 1 : 0 }} />
    </motion.div>
  )
}

/** The tester's finger: a soft dot that presses on each tap, with a ripple (orange when the tap does nothing). */
function Touch() {
  const x = useTrack((t) => path(t, TOUCH)[0])
  const y = useTrack((t) => path(t, TOUCH)[1])
  const opacity = useTrack((t) => Math.max(ramp(t, S1.live[0], S1.live[0] + 0.25) * (1 - ramp(t, S1.live[1] - 0.3, S1.live[1])), ramp(t, S2.live[0], S2.live[0] + 0.25) * (1 - ramp(t, S2.live[1] - 0.3, S2.live[1]))))
  const scale = useTrack((t) => 1 - 0.28 * Math.max(...TAPS.map((p) => Math.sin(Math.PI * ramp(t, p.at - 0.06, p.at + 0.12, E.linear)))))
  const who = useAt((t) => (t < RESET[0] ? "Alex" : "Sam"))
  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-40" style={{ x, y, opacity }}>
      <motion.span className="absolute size-[30px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/90 bg-white/35 shadow-[0_2px_10px_rgba(0,0,0,0.3)]" style={{ scale }} />
      <span className="absolute top-[14px] left-[12px] rounded-[5px] bg-[#6b5bd6] px-1.5 py-[3px] font-sans text-[11px] font-semibold whitespace-nowrap text-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]">{who}</span>
    </motion.div>
  )
}

function Ripple({ at, pt, dead }: Tap) {
  const shown = useAt((t) => t >= at && t < at + 0.5)
  const scale = useTrack((t) => 0.6 + 1.6 * ramp(t, at, at + 0.5, E.out))
  const opacity = useTrack((t) => 0.8 * (1 - ramp(t, at, at + 0.5, E.linear)))
  if (!shown) return null
  const [x, y] = phonePt(pt)
  return <motion.span className={cn("pointer-events-none absolute z-30 size-[30px] rounded-full border-2", dead ? "border-[#ff7a1a]" : "border-white")} style={{ left: x - 15, top: y - 15, scale, opacity }} />
}

function Pointer() {
  const x = useTrack((t) => path(t, YOU)[0])
  const y = useTrack((t) => path(t, YOU)[1])
  const opacity = useTrack((t) => ramp(t, 4.4, 4.65) * (1 - ramp(t, 7.7, 8.0)))
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

export function UseCasePMUserTestsScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Chat />
        <Phone />
        <Notes />
        {TAPS.map((p, i) => (
          <Ripple key={i} {...p} />
        ))}
        <Touch />
        <Pointer />
      </Fade>
      <style>{`@keyframes ut-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .ut-caret { animation: ut-caret 1s step-end infinite }
@keyframes ut-pop { from { opacity: 0; transform: scale(.85) } } .ut-pop { animation: ut-pop .25s cubic-bezier(.22,1,.36,1) both }
@keyframes ut-live { 50% { opacity: .3 } } .ut-live { animation: ut-live 1.2s ease-in-out infinite }`}</style>
    </Scene>
  )
}

export default function UseCasePMUserTests() {
  return (
    <ScenePage label="PMs · Test it with users">
      <UseCasePMUserTestsScene />
    </ScenePage>
  )
}
