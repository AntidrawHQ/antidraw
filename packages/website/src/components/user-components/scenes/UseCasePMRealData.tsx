/**
 * PMs · "Real data, real logic": drop in a sample of real data and give the
 * prototype logic a picture can't fake.
 *
 * Same language as UseCasePMClickFlows, on a transparent stage:
 *   0–2.3s    GoalsList is on the canvas with its three made-up goals. The PM
 *             selects it, then drags goals_sample.csv (a real export, messy)
 *             into the chat; both land as chips.
 *   2.5–4.7s  "Hook GoalsList up to this export. Add search, sorting and a
 *             real total, and make sure the messy rows still look right."
 *   4.9–8.1s  The agent reads the file (a band runs down the sheet) and flags
 *             what's messy right on the cells: a long name, over target, no
 *             name, $0 saved. The phone rebuilds on the data: a real total,
 *             search, sort, and a look for each of the messy rows.
 *   8.2s      The reply.
 *   8.9–11.7s The PM tries it: searches "trip" (misses fade, hits close up,
 *             the total counts down, the matching rows light up in the
 *             sheet), then sorts by Progress (the rows reorder).
 *   12s–      Held, then a fade through the loop seam.
 *
 * Pieces: usecase/design/chat.tsx, usecase/design/thread.tsx (FileChip).
 * Data, sheet and screen: usecase/pm/goaldata.tsx.
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { BLUE, Cursor, E, Scene, ScenePage, Skeleton, kf, path, ramp, typed, useAt, useTrack, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Chip, Reveal, ToolGroup, ToolRow } from "../usecase/design/chat"
import { FileChip } from "../usecase/design/thread"
import { GOAL_H, GOAL_W, GoalsList } from "../usecase/pm/goals"
import { DATA_SEARCH_AT, DATA_SORT_AT, FLAGS, GoalSheet, GoalsData, MATCH_COUNT, MATCH_SAVED, QUERY, SHEET_FILE_AT, SHEET_H, TOTAL_ROWS, TOTAL_SAVED } from "../usecase/pm/goaldata"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 15.5
const STILL = 12.6

const FILE = "goals_sample.csv"
const PROMPT = "Hook GoalsList up to this export. Add search, sorting and a real total, and make sure the messy rows still look right."
const T = { select: 0.75, grab: 1.35, drop: 2.2, type: [2.5, 4.35] as const, send: 4.7, reply: 8.2 }

const ROWS = [
  { title: `Read ${FILE} · ${TOTAL_ROWS} rows`, start: 4.95, done: 5.95 },
  { title: "Wiring GoalsList to the data", start: 5.95, done: 7.45 },
  { title: `Check it with all ${TOTAL_ROWS} rows`, start: 7.45, done: 8.0 },
]
const SCAN = [5.0, 5.5] as const
const FLAG_AT = FLAGS.map((_, i) => 5.5 + i * 0.13)

/* ── Layout ───────────────────────────────────────────────────────────── */

const CHAT = { x: 72, y: 96, w: 300, h: 570 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]
const DROP_AT: [number, number] = [CHAT.x + 70, CHAT.y + CHAT.h - 70]

const SHEET = { x: 412, y: 381 - SHEET_H / 2 }
const FILE_AT: [number, number] = [SHEET.x + SHEET_FILE_AT[0], SHEET.y + SHEET_FILE_AT[1]]

const PS = 0.95
const PHONE = { x: 904, y: 96, w: GOAL_W * PS, h: GOAL_H * PS }
const phonePt = ([fx, fy]: readonly [number, number]): [number, number] => [PHONE.x + fx * PS, PHONE.y + fy * PS]

/* ── The try-out ──────────────────────────────────────────────────────── */

const SKEL = [6.05, 6.3] as const
const FILL = [7.0, 7.45] as const
const CLICK = { search: 9.0, sort: 10.9 }
const QTYPE = [9.25, 9.7] as const
const FILTER = [9.8, 10.4] as const
const SORT = [11.0, 11.6] as const

const YOU: PathKey[] = [
  [0, 760, 640],
  [T.select - 0.45, 760, 640],
  [T.select - 0.05, ...phonePt([150, 300]), E.inOut],
  [T.select + 0.15, ...phonePt([150, 300])],
  [T.grab - 0.05, ...FILE_AT, E.inOut],
  [T.grab + 0.1, ...FILE_AT],
  [T.drop - 0.05, ...DROP_AT, E.inOut, true],
  [T.drop + 0.25, ...DROP_AT],
  [T.send - 0.5, ...DROP_AT],
  [T.send - 0.1, ...SEND_AT, E.inOut],
  [T.send + 0.4, ...SEND_AT],
  [6.2, 820, 660, E.inOut],
  [CLICK.search - 0.6, 820, 660],
  [CLICK.search - 0.1, ...phonePt(DATA_SEARCH_AT), E.inOut],
  [CLICK.search + 0.2, ...phonePt(DATA_SEARCH_AT)],
  [CLICK.sort - 0.55, ...phonePt([DATA_SEARCH_AT[0] + 20, DATA_SEARCH_AT[1] + 10]), E.inOut],
  [CLICK.sort - 0.1, ...phonePt(DATA_SORT_AT(1)), E.inOut],
  [CLICK.sort + 0.25, ...phonePt(DATA_SORT_AT(1))],
  [12.3, ...phonePt([250, 640]), E.inOut],
  [DUR, ...phonePt([250, 640])],
]
const CLICKS = [T.select, T.grab, T.send, CLICK.search, CLICK.sort]

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Chat() {
  const opacity = useTrack((t) => ramp(t, 0.2, 0.6))
  const typing = useAt((t) => t < T.send)
  const n = useAt((t) => typed(t, T.type[0], T.type[1], PROMPT))
  const press = useAt((t) => Math.round(Math.sin(Math.PI * ramp(t, T.send - 0.08, T.send + 0.12, E.linear)) * 10) / 10)
  const sent = useAt((t) => t >= T.send + 0.1)
  const frameChip = useAt((t) => t >= T.select + 0.05 && t < T.send)
  const fileChip = useAt((t) => t >= T.drop && t < T.send)
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
              <Chip frame="GoalsList" />
              <FileChip name={FILE} />
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
          <AssistantText>
            GoalsList now runs on all {TOTAL_ROWS} rows. The total adds up whatever's in view, search and sort work on the real data, and long names, blank names, $0 and over-target goals each have a look. Try it.
          </AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 min-h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 pb-11 shadow-xs">
        {(frameChip || fileChip) && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {frameChip && <Chip frame="GoalsList" className="rd-pop" />}
            {fileChip && <FileChip name={FILE} className="rd-pop" />}
          </div>
        )}
        <div className="pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {typing && n > 0 ? PROMPT.slice(0, n) : <span className="text-neutral-400">Ask me anything...</span>}
          {typing && n > 0 && <span className="rd-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
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

function Sheet() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const scan = useAt((t) => (t >= SCAN[0] && t < SCAN[1] + 0.05 ? Math.round(ramp(t, SCAN[0], SCAN[1], E.linear) * 60) / 60 : -1))
  const flags = useAt((t) => FLAG_AT.filter((a) => t >= a).length)
  const quiet = useAt((t) => t >= FILL[1] + 0.4)
  const match = useAt((t) => Math.round(ramp(t, FILTER[0], FILTER[0] + 0.35) * 20) / 20)
  const lifted = useAt((t) => t >= T.grab && t < T.drop)
  return (
    <motion.div className="absolute" style={{ left: SHEET.x, top: SHEET.y, opacity }}>
      <GoalSheet scan={scan} flags={flags} quiet={quiet} match={match} lifted={lifted} />
    </motion.div>
  )
}

/** The file, following the pointer while it's dragged into the chat. */
function DragGhost() {
  const shown = useAt((t) => t >= T.grab && t < T.drop)
  const x = useTrack((t) => path(t, YOU)[0] + 10)
  const y = useTrack((t) => path(t, YOU)[1] + 12)
  const scale = useTrack((t) => kf(t, [[T.grab, 0.85], [T.grab + 0.25, 1, E.pop]]))
  if (!shown) return null
  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-40 rotate-[-2deg] rounded-md bg-[#2A2A2A] shadow-[0_8px_20px_-6px_rgba(0,0,0,0.5)]" style={{ x, y, scale }}>
      <FileChip name={FILE} />
    </motion.div>
  )
}

/** A screen at frame size, scaled. */
const Fit = ({ s, children }: { s: number; children: ReactNode }) => (
  <div className="relative origin-top-left" style={{ width: GOAL_W, height: GOAL_H, scale: s }}>
    {children}
  </div>
)

function Phone() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const selected = useAt((t) => t >= T.select && t < T.send)
  const listOp = useTrack((t) => 1 - ramp(t, SKEL[0], SKEL[1]))
  const listOn = useAt((t) => t < SKEL[1])
  const built = useAt((t) => t >= FILL[0])
  const clipPath = useTrack((t) => `inset(0 0 ${(1 - ramp(t, FILL[0], FILL[1], E.inOut)) * 100}% 0)`)
  const focus = useAt((t) => t >= CLICK.search && t < CLICK.sort)
  const q = useAt((t) => QUERY.slice(0, typed(t, QTYPE[0], QTYPE[1], QUERY)))
  const filter = useAt((t) => Math.round(ramp(t, FILTER[0], FILTER[1], E.inOut) * 60) / 60)
  const sort = useAt((t) => Math.round(ramp(t, SORT[0], SORT[1], E.inOut) * 60) / 60)
  const total = useAt((t) => Math.round(TOTAL_SAVED + (MATCH_SAVED - TOTAL_SAVED) * ramp(t, FILTER[0], FILTER[1] + 0.2, E.out)))
  const count = useAt((t) => Math.round(TOTAL_ROWS + (MATCH_COUNT - TOTAL_ROWS) * ramp(t, FILTER[0], FILTER[1] + 0.2, E.out)))
  return (
    <motion.div className="absolute font-sans" style={{ left: PHONE.x, top: PHONE.y - 22, width: PHONE.w, opacity }}>
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">GoalsList</div>
      <div className="relative overflow-hidden rounded-[22px] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.08]" style={{ height: PHONE.h }}>
        <Skeleton />
        {listOn && (
          <motion.div className="absolute inset-0" style={{ opacity: listOp }}>
            <Fit s={PS}>
              <GoalsList />
            </Fit>
          </motion.div>
        )}
        {built && (
          <motion.div className="absolute inset-0" style={{ clipPath }}>
            <Fit s={PS}>
              <GoalsData query={q} focus={focus} filter={filter} sort={sort} total={total} count={count} />
            </Fit>
          </motion.div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-[22px] transition-opacity duration-200" style={{ top: 22, boxShadow: `0 0 0 1.5px ${BLUE}`, opacity: selected ? 1 : 0 }} />
    </motion.div>
  )
}

function Pointer() {
  const x = useTrack((t) => path(t, YOU)[0])
  const y = useTrack((t) => path(t, YOU)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6) * (1 - ramp(t, 12.4, 12.8)))
  const press = useTrack((t) => 1 - 0.16 * Math.max(...CLICKS.map((c) => Math.sin(Math.PI * ramp(t, c - 0.08, c + 0.12, E.linear))), t >= T.grab + 0.05 && t < T.drop - 0.05 ? 0.6 : 0))
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

export function UseCasePMRealDataScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Chat />
        <Sheet />
        <Phone />
        <DragGhost />
        <Pointer />
      </Fade>
      <style>{`@keyframes rd-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .rd-caret { animation: rd-caret 1s step-end infinite }
@keyframes rd-pop { from { opacity: 0; transform: scale(.85) } } .rd-pop { animation: rd-pop .25s cubic-bezier(.22,1,.36,1) both }`}</style>
    </Scene>
  )
}

export default function UseCasePMRealData() {
  return (
    <ScenePage label="PMs · Real data, real logic">
      <UseCasePMRealDataScene />
    </ScenePage>
  )
}
