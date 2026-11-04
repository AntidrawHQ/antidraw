/**
 * PMs · "Real flows you can click through": screens that link up, with the
 * transitions and loading states in place.
 *
 * Same language as UseCasePMPrdTakes, on a transparent stage:
 *   0–1.6s    The four screens are already on the canvas as separate
 *             components (GoalKind, GoalAmount, GoalReview, GoalDone). The PM
 *             drag-selects all four; they land as chips in the chat input.
 *   1.9–4.1s  "Put these together into one flow I can click through. Make the
 *             transitions between screens interesting." The agent picks the
 *             transitions (and adds the loading state on its own).
 *   4.4–6.7s  It links them: arrows draw between the screens, one by one, and
 *             the big phone (GoalFlow, one component) fills in with step one.
 *   7.5s      The reply: linked, here's what the transitions do, try it.
 *   8–13s      The PM clicks through it for real, and each step has its own
 *             transition: picks A trip, Continue (the tile grows into the
 *             Amount screen's header while the rest fades), taps $2,000 (the
 *             amount rolls), Continue (Review rises as a sheet, Amount sinks
 *             back), Create goal (the button collapses into a spinner, then
 *             the done screen opens out of it in a circle; ring and tick
 *             play). The map outlines whichever screen the phone is on.
 *   12s–      Held, then a fade through the loop seam.
 *
 * Pieces: usecase/design/chat.tsx (Reveal, ToolGroup/ToolRow, UserBubble,
 * AssistantText). Screens: usecase/pm/goals.tsx (GoalsStart) and
 * usecase/pm/goalflow.tsx.
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { BLUE, Cursor, E, Scene, ScenePage, Skeleton, kf, path, ramp, typed, useAt, useTrack, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Chip, Reveal, ToolGroup, ToolRow, UserBubble } from "../usecase/design/chat"
import { GOAL_H, GOAL_W, GoalsStart, START_TILE_AT } from "../usecase/pm/goals"
import { FLOW_AMOUNT_AT, FLOW_CREATE_AT, FLOW_NEXT_AT, GoalAmount, GoalDone, GoalReview, KindMorph, REVIEW_SHEET_Y } from "../usecase/pm/goalflow"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 17
const STILL = 14.2

const PROMPT = "Put these together into one flow I can click through. Make the transitions between screens interesting."
const T = { sel: [0.55, 1.5] as const, type: [1.95, 3.75] as const, send: 4.1, reply: 7.5 }

const ROWS = [
  { title: "Read GoalKind.tsx +3", start: 4.4, done: 4.8 },
  { title: "Crafting GoalFlow", start: 4.8, done: 6.75 },
  { title: "Check the flow runs", start: 6.75, done: 7.3 },
]

/* ── Layout ───────────────────────────────────────────────────────────── */

const CHAT = { x: 60, y: 96, w: 300, h: 570 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]

const PS = 0.95
const PHONE = { x: 420, y: 96, w: GOAL_W * PS, h: GOAL_H * PS }
const phonePt = ([fx, fy]: readonly [number, number]): [number, number] => [PHONE.x + fx * PS, PHONE.y + fy * PS]

const MS = 0.4
const MW = GOAL_W * MS
const MH = GOAL_H * MS
const MX = 830
const MY = 118
/** The map runs clockwise: top-left, top-right, bottom-right, bottom-left. */
const MINI = [
  [MX, MY],
  [MX + MW + 70, MY],
  [MX + MW + 70, MY + MH + 58],
  [MX, MY + MH + 58],
] as const
const NAMES = ["GoalKind", "GoalAmount", "GoalReview", "GoalDone"]
/** When each arrow draws (Kind→Amount, Amount→Review, Review→Done). */
const LINK_AT = [5.1, 5.5, 5.9]

/** The marquee the PM drags around all four. */
const SEL_FROM: [number, number] = [MX - 26, MY - 50]
const SEL_TO: [number, number] = [MX + 2 * MW + 70 + 26, MY + 2 * MH + 58 + 22]

/* ── The click-through ────────────────────────────────────────────────── */

const PHONE_AT = 6.05
const PHONE_FILL = [6.15, 6.65] as const
const CLICK = { tile: 8.1, next1: 8.8, chip: 9.6, next2: 10.3, create: 11.1 }
const LOAD = [CLICK.create + 0.05, CLICK.create + 0.95] as const
/** The three transitions: the picked tile grows into Amount's header; Review rises as a sheet; Create collapses to a spinner, then Done opens out of it in a circle. */
const MORPH = [CLICK.next1 + 0.05, CLICK.next1 + 0.65] as const
const SHEET = [CLICK.next2 + 0.05, CLICK.next2 + 0.6] as const
const COLLAPSE = [CLICK.create + 0.05, CLICK.create + 0.35] as const
const REVEAL = [LOAD[1], LOAD[1] + 0.5] as const
const DONE = [REVEAL[1], REVEAL[1] + 0.9] as const

/** Which step the phone is on. */
const stepAt = (t: number) => (t >= REVEAL[0] ? 3 : t >= SHEET[0] ? 2 : t >= MORPH[0] ? 1 : 0)

const YOU: PathKey[] = [
  [0, 720, 300],
  [T.sel[0] - 0.05, ...SEL_FROM, E.inOut],
  [T.sel[1], ...SEL_TO, E.inOut],
  [T.sel[1] + 0.45, 300, 600, E.inOut],
  [T.send - 0.55, 300, 600],
  [T.send - 0.1, ...SEND_AT, E.inOut],
  [T.send + 0.4, ...SEND_AT],
  [5.6, 760, 420, E.inOut],
  [CLICK.tile - 0.6, 760, 420],
  [CLICK.tile - 0.1, ...phonePt(START_TILE_AT(0)), E.inOut],
  [CLICK.tile + 0.2, ...phonePt(START_TILE_AT(0))],
  [CLICK.next1 - 0.1, ...phonePt(FLOW_NEXT_AT), E.inOut],
  [CLICK.next1 + 0.3, ...phonePt(FLOW_NEXT_AT)],
  [CLICK.chip - 0.1, ...phonePt(FLOW_AMOUNT_AT(2)), E.inOut],
  [CLICK.chip + 0.2, ...phonePt(FLOW_AMOUNT_AT(2))],
  [CLICK.next2 - 0.1, ...phonePt(FLOW_NEXT_AT), E.inOut],
  [CLICK.next2 + 0.3, ...phonePt(FLOW_NEXT_AT)],
  [CLICK.create - 0.1, ...phonePt(FLOW_CREATE_AT), E.inOut],
  [CLICK.create + 0.3, ...phonePt(FLOW_CREATE_AT)],
  [13.3, 760, 640, E.inOut],
  [DUR, 760, 640],
]
const CLICKS = [T.send, CLICK.tile, CLICK.next1, CLICK.chip, CLICK.next2, CLICK.create]

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Chat() {
  const opacity = useTrack((t) => ramp(t, 0.2, 0.6))
  const typing = useAt((t) => t < T.send)
  const n = useAt((t) => typed(t, T.type[0], T.type[1], PROMPT))
  const press = useAt((t) => Math.round(Math.sin(Math.PI * ramp(t, T.send - 0.08, T.send + 0.12, E.linear)) * 10) / 10)
  const sent = useAt((t) => t >= T.send + 0.1)
  const chips = useAt((t) => t >= T.sel[1] + 0.1 && t < T.send)
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
          <UserBubble className="[&>div]:max-w-[92%]" tags={NAMES.map((frame) => ({ frame }))}>
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
          <AssistantText>GoalFlow puts all four into one component, linked in order. The kind you pick grows into the next screen, the review rises as a sheet, and Create goal spins, then opens into the done screen. Click through it.</AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 min-h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 pb-11 shadow-xs">
        {chips && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {NAMES.map((frame) => (
              <Chip key={frame} frame={frame} className="flw-pop" />
            ))}
          </div>
        )}
        <div className="pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {typing && n > 0 ? PROMPT.slice(0, n) : <span className="text-neutral-400">Ask me anything...</span>}
          {typing && n > 0 && <span className="flw-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
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

/** A screen at frame size, scaled. */
const Fit = ({ s, children }: { s: number; children: ReactNode }) => (
  <div className="relative origin-top-left" style={{ width: GOAL_W, height: GOAL_H, scale: s }}>
    {children}
  </div>
)

const SCREENS: ReactNode[] = [<GoalsStart pick={0} />, <GoalAmount amount={2000} chip={2} />, <GoalReview />, <GoalDone />]

const miniSelectedAt = (k: number) => (t: number) => {
  if (t < T.sel[0] || t >= T.send) return false
  const [cx, cy] = path(t, YOU)
  return cx >= MINI[k][0] + MW && cy >= MINI[k][1] + MH
}

function Mini({ k }: { k: number }) {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const on = useAt((t) => t >= PHONE_FILL[1] && stepAt(t) === k)
  const selected = useAt(miniSelectedAt(k))
  const linked = useAt((t) => t >= LINK_AT[Math.max(0, k - 1)] + 0.3)
  const [x, y] = MINI[k]
  return (
    <motion.div className="absolute font-sans" style={{ left: x, top: y - 20, width: MW, opacity }}>
      <div className={cn("mb-1.5 flex items-center gap-1.5 text-[11px] font-medium transition-colors duration-200", on ? "text-white" : "text-white/45")}>
        {linked && <span className={cn("flw-pop grid size-4 place-items-center rounded-full text-[9.5px] transition-colors duration-200", on ? "bg-[#3b82f6] text-white" : "bg-white/[0.08]")}>{k + 1}</span>}
        {NAMES[k]}
      </div>
      <div className="relative overflow-hidden rounded-[10px] shadow-[0_8px_20px_-10px_rgba(0,0,0,0.3)] ring-1 ring-white/[0.08]" style={{ height: MH }}>
        <Fit s={MS}>{SCREENS[k]}</Fit>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-[10px] transition-opacity duration-200" style={{ top: 20, boxShadow: on ? `0 0 0 2px ${BLUE}, 0 0 0 6px rgba(59,130,246,0.2)` : `0 0 0 1.5px ${BLUE}`, opacity: on || selected ? 1 : 0 }} />
    </motion.div>
  )
}

/** The drag-select rectangle, while the PM drags it. */
function Marquee() {
  const box = (t: number) => {
    const [cx, cy] = path(t, YOU)
    return { w: Math.max(0, cx - SEL_FROM[0]), h: Math.max(0, cy - SEL_FROM[1]) }
  }
  const width = useTrack((t) => box(t).w)
  const height = useTrack((t) => box(t).h)
  const opacity = useTrack((t) => ramp(t, T.sel[0], T.sel[0] + 0.08) * (1 - ramp(t, T.sel[1] + 0.02, T.sel[1] + 0.15)))
  const shown = useAt((t) => t >= T.sel[0] && t < T.sel[1] + 0.2)
  if (!shown) return null
  return <motion.div className="pointer-events-none absolute border border-[#3b82f6] bg-[#3b82f6]/[0.08]" style={{ left: SEL_FROM[0], top: SEL_FROM[1], width, height, opacity }} />
}

/** Arrows between the minis, drawn as the agent links them. */
function Links() {
  const segs: [number, number, number, number][] = [
    [MINI[0][0] + MW + 8, MINI[0][1] + MH / 2, MINI[1][0] - 8, MINI[1][1] + MH / 2],
    [MINI[1][0] + MW / 2, MINI[1][1] + MH + 8, MINI[2][0] + MW / 2, MINI[2][1] - 28],
    [MINI[2][0] - 8, MINI[2][1] + MH / 2, MINI[3][0] + MW + 8, MINI[3][1] + MH / 2],
  ]
  return (
    <svg className="pointer-events-none absolute inset-0 overflow-visible" width={W} height={H}>
      <defs>
        <marker id="flw-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 1 L 8 5 L 0 9" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      {segs.map((s, k) => (
        <Link key={k} seg={s} at={LINK_AT[k]} />
      ))}
    </svg>
  )
}

function Link({ seg: [x1, y1, x2, y2], at }: { seg: [number, number, number, number]; at: number }) {
  const len = useTrack((t) => ramp(t, at, at + 0.4, E.out))
  const opacity = useTrack((t) => ramp(t, at, at + 0.1))
  const head = useAt((t) => t >= at + 0.35)
  return <motion.path d={`M ${x1} ${y1} L ${x2} ${y2}`} stroke="rgba(255,255,255,0.5)" strokeWidth={1.6} fill="none" markerEnd={head ? "url(#flw-head)" : undefined} style={{ pathLength: len, opacity }} />
}

function Phone() {
  const opacity = useTrack((t) => ramp(t, PHONE_AT, PHONE_AT + 0.25))
  const scale = useTrack((t) => kf(t, [[PHONE_AT, 0.95], [PHONE_AT + 0.5, 1, E.pop]]))
  const clipPath = useTrack((t) => `inset(0 0 ${(1 - ramp(t, PHONE_FILL[0], PHONE_FILL[1], E.inOut)) * 100}% 0)`)
  const pick = useAt((t) => (t >= CLICK.tile ? 0 : -1))
  const chip = useAt((t) => (t >= CLICK.chip ? 2 : 1))
  const amount = useAt((t) => Math.round(1000 + 1000 * ramp(t, CLICK.chip + 0.05, CLICK.chip + 0.5, E.out)))
  // Kind → Amount: Kind fades, the tile morphs into the header, Amount's body rises in.
  const kindOp = useTrack((t) => 1 - ramp(t, MORPH[0], MORPH[0] + 0.25))
  const morph = useAt((t) => Math.round(ramp(t, MORPH[0], MORPH[1], E.inOut) * 60) / 60)
  const body = useAt((t) => Math.round(ramp(t, MORPH[0] + 0.3, MORPH[1] + 0.1, E.out) * 30) / 30)
  const morphing = useAt((t) => t >= MORPH[0] && t < MORPH[1])
  // Amount → Review: the sheet rises, Amount sinks back behind it.
  const sheetY = useTrack((t) => (1 - ramp(t, SHEET[0], SHEET[1], E.out)) * PHONE.h + REVIEW_SHEET_Y * PS)
  const backScale = useTrack((t) => 1 - 0.07 * ramp(t, SHEET[0], SHEET[1], E.out))
  const backRadius = useTrack((t) => 22 * ramp(t, SHEET[0], SHEET[1], E.out))
  const scrim = useTrack((t) => 0.35 * ramp(t, SHEET[0], SHEET[1], E.out))
  // Create → Done: the button collapses to a spinner, then Done opens out of it.
  const collapse = useAt((t) => Math.round(ramp(t, COLLAPSE[0], COLLAPSE[1], E.inOut) * 30) / 30)
  const [cx, cy] = [FLOW_CREATE_AT[0] * PS, FLOW_CREATE_AT[1] * PS]
  const reveal = useTrack((t) => `circle(${ramp(t, REVEAL[0], REVEAL[1], E.inOut) * 720}px at ${cx}px ${cy}px)`)
  const doneOp = useTrack((t) => ramp(t, REVEAL[1] - 0.1, REVEAL[1] + 0.25))
  const done = useAt((t) => Math.round(ramp(t, DONE[0], DONE[1], E.linear) * 40) / 40)
  const step = useAt(stepAt)
  const kindOn = useAt((t) => t < MORPH[1])
  return (
    <motion.div className="absolute font-sans" style={{ left: PHONE.x, top: PHONE.y - 22, width: PHONE.w, opacity, scale }}>
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">GoalFlow</div>
      <div className="relative overflow-hidden rounded-[22px] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.08]" style={{ height: PHONE.h }}>
        <Skeleton />
        <motion.div className="absolute inset-0 bg-[#101410]" style={{ clipPath }}>
          {step >= 1 && step < 3 && (
            <motion.div className="absolute inset-0 origin-top overflow-hidden" style={{ scale: backScale, borderRadius: backRadius }}>
              <Fit s={PS}>
                <GoalAmount amount={amount} chip={chip} header={!morphing} body={body} />
              </Fit>
              <motion.div className="absolute inset-0 bg-black" style={{ opacity: scrim }} />
            </motion.div>
          )}
          {kindOn && (
            <motion.div className="absolute inset-0" style={{ opacity: kindOp }}>
              <Fit s={PS}>
                <GoalsStart pick={pick} />
              </Fit>
            </motion.div>
          )}
          {morphing && (
            <div className="absolute inset-0">
              <Fit s={PS}>
                <KindMorph p={morph} />
              </Fit>
            </div>
          )}
          {step >= 2 && (
            <motion.div className="absolute inset-0 overflow-hidden rounded-t-[22px] shadow-[0_-10px_30px_rgba(0,0,0,0.25)]" style={{ y: sheetY }}>
              <Fit s={PS}>
                <GoalReview sheet collapse={collapse} />
              </Fit>
            </motion.div>
          )}
          {step >= 3 && (
            <motion.div className="absolute inset-0" style={{ clipPath: reveal, background: "#0d4a12" }}>
              <motion.div className="absolute inset-0" style={{ opacity: doneOp }}>
                <Fit s={PS}>
                  <GoalDone p={done} />
                </Fit>
              </motion.div>
            </motion.div>
          )}
        </motion.div>
      </div>
    </motion.div>
  )
}

function Pointer() {
  const x = useTrack((t) => path(t, YOU)[0])
  const y = useTrack((t) => path(t, YOU)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6) * (1 - ramp(t, 13.5, 13.9)))
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

export function UseCasePMClickFlowsScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Chat />
        <Links />
        {[0, 1, 2, 3].map((k) => (
          <Mini key={k} k={k} />
        ))}
        <Marquee />
        <Phone />
        <Pointer />
      </Fade>
      <style>{`@keyframes flw-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .flw-caret { animation: flw-caret 1s step-end infinite }
@keyframes flw-pop { from { opacity: 0; transform: scale(.85) } } .flw-pop { animation: flw-pop .25s cubic-bezier(.22,1,.36,1) both }`}</style>
    </Scene>
  )
}

export default function UseCasePMClickFlows() {
  return (
    <ScenePage label="PMs · Real flows you can click through">
      <UseCasePMClickFlowsScene />
    </ScenePage>
  )
}
