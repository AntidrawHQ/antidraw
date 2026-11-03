/**
 * Sales · "Mockups with their data": the prospect's logo, colours and
 * records, inside your product, before they've signed anything.
 *
 * Same language as UseCasePMRealData, on a transparent stage:
 *   0–3.9s    Tally's Locations screen is on the canvas with its seed data
 *             (Site 01…06, Anytown, round numbers). Below it sit
 *             kestrel-logo.png and kestrel_gyms.csv. The rep selects the
 *             screen, then drags the logo and the CSV into the chat; all
 *             three land as chips.
 *   4.0–5.8s  "Demo with Kestrel tomorrow. Make this look like it's theirs."
 *   6.0–7.2s  The agent reads the CSV (a band runs down the sheet) and the
 *             logo (its two colours pop up on the tile).
 *   7.35–10.2s The re-skin plays in place: a copy of the mark flies from the
 *             tile into the nav and lands as "Kestrel Climbing"; a slanted
 *             sweep turns Tally's indigo into Kestrel's slate and orange
 *             (and the screen's words into theirs: Gyms, Members,
 *             Check-ins); then the rows swap one by one for their six gyms
 *             while the numbers roll, each CSV row lighting as it lands.
 *   10.35s    The reply.
 *   11.0–13.4s The rep clicks into The Foundry: the detail drawer slides
 *             in, its check-ins chart grows, and hovering 6p shows the
 *             peak. It's the live product, not a picture.
 *   13.8s–    Held, then a fade through the loop seam.
 *
 * Pieces: usecase/design/chat.tsx, usecase/design/thread.tsx (FileChip).
 * Screen, brand and data: usecase/sales/mockup.tsx (Tally's mark from
 * usecase/sales/demo.tsx).
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { BLUE, Cursor, E, Scene, ScenePage, kf, path, ramp, typed, useAt, useTrack, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Chip, Reveal, ToolGroup, ToolRow } from "../usecase/design/chat"
import { FileChip } from "../usecase/design/thread"
import {
  DASH_BAR_AT,
  DASH_H,
  DASH_MARK_AT,
  DASH_MARK_SIZE,
  DASH_ROW_AT,
  DASH_W,
  GYMS,
  GYMS_FILE,
  GymSheet,
  ImageChip,
  KESTREL_FILE,
  KestrelMark,
  LogoTile,
  PEAK,
  SHEET_FILE_AT,
  SHEET_H,
  TILE,
  TILE_MARK_AT,
  TILE_MARK_SIZE,
  TallyLocations,
  rowP,
} from "../usecase/sales/mockup"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 16.5
const STILL = 14.8

const FRAME = "TallyLocations"
const PROMPT = "Demo with Kestrel tomorrow. Make this look like it's theirs."
const T = { select: 0.8, grabLogo: 1.5, dropLogo: 2.35, grabCsv: 2.85, dropCsv: 3.7, type: [4.0, 5.35] as const, send: 5.75, reply: 10.35 }

const ROWS = [
  { title: `Read ${GYMS_FILE} · ${GYMS.length} gyms`, start: 6.0, done: 6.7 },
  { title: `Read ${KESTREL_FILE}`, start: 6.7, done: 7.2 },
  { title: `Editing ${FRAME}`, start: 7.2, done: 10.15 },
]
const SCAN = [6.05, 6.6] as const
const SWATCH_AT = [6.85, 7.0]

/* ── The re-skin ──────────────────────────────────────────────────────── */

const FLY = [7.35, 8.0] as const
const SWEEP = [8.15, 9.0] as const
const FILL = [9.0, 10.2] as const

/* ── Layout ───────────────────────────────────────────────────────────── */

const CHAT = { x: 72, y: 64, w: 300, h: 612 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]
const DROP_AT: [number, number] = [CHAT.x + 80, CHAT.y + CHAT.h - 70]

const DASH = { x: 412, y: 64 }
const dashPt = ([dx, dy]: readonly [number, number]): [number, number] => [DASH.x + dx, DASH.y + dy]

const LOGO = { x: 412, y: 516 }
const LOGO_GRAB: [number, number] = [LOGO.x + TILE / 2, LOGO.y + TILE / 2 + 8]
const SHEET = { x: 592, y: CHAT.y + CHAT.h - SHEET_H }
const FILE_AT: [number, number] = [SHEET.x + SHEET_FILE_AT[0], SHEET.y + SHEET_FILE_AT[1]]

/** The flying mark: from the logo tile to the nav. */
const MARK_FROM: [number, number] = [LOGO.x + TILE_MARK_AT[0], LOGO.y + TILE_MARK_AT[1]]
const MARK_TO = dashPt(DASH_MARK_AT)
const MARK_PATH: PathKey[] = [
  [FLY[0], ...MARK_FROM],
  [FLY[1], ...MARK_TO, E.inOut],
]

/* ── The try-out ──────────────────────────────────────────────────────── */

const CLICK = { row: 11.7 }
const DRAWER = [11.8, 12.2] as const
const GROW = [12.1, 12.75] as const
const BAR = { at: 13.35 }
const REST: [number, number] = [392, 470]

const YOU: PathKey[] = [
  [0, 1010, 420],
  [T.select - 0.45, 1010, 420],
  [T.select - 0.05, ...dashPt([520, 280]), E.inOut],
  [T.select + 0.15, ...dashPt([520, 280])],
  [T.grabLogo - 0.05, ...LOGO_GRAB, E.inOut],
  [T.grabLogo + 0.1, ...LOGO_GRAB],
  [T.dropLogo - 0.05, ...DROP_AT, E.inOut, true],
  [T.dropLogo + 0.25, ...DROP_AT],
  [T.grabCsv - 0.05, ...FILE_AT, E.inOut],
  [T.grabCsv + 0.1, ...FILE_AT],
  [T.dropCsv - 0.05, ...DROP_AT, E.inOut, true],
  [T.dropCsv + 0.25, ...DROP_AT],
  [T.send - 0.5, ...DROP_AT],
  [T.send - 0.1, ...SEND_AT, E.inOut],
  [T.send + 0.4, ...SEND_AT],
  [6.5, ...REST, E.inOut],
  [CLICK.row - 0.75, ...REST],
  [CLICK.row - 0.1, ...dashPt(DASH_ROW_AT(0)), E.inOut],
  [CLICK.row + 0.3, ...dashPt(DASH_ROW_AT(0))],
  [BAR.at - 0.05, ...dashPt(DASH_BAR_AT(PEAK)), E.inOut],
  [DUR, ...dashPt(DASH_BAR_AT(PEAK))],
]
const CLICKS = [T.select, T.grabLogo, T.grabCsv, T.send, CLICK.row]
const dragging = (t: number) => (t >= T.grabLogo + 0.05 && t < T.dropLogo - 0.05) || (t >= T.grabCsv + 0.05 && t < T.dropCsv - 0.05)

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Chat() {
  const opacity = useTrack((t) => ramp(t, 0.2, 0.6))
  const typing = useAt((t) => t < T.send)
  const n = useAt((t) => typed(t, T.type[0], T.type[1], PROMPT))
  const press = useAt((t) => Math.round(Math.sin(Math.PI * ramp(t, T.send - 0.08, T.send + 0.12, E.linear)) * 10) / 10)
  const sent = useAt((t) => t >= T.send + 0.1)
  const frameChip = useAt((t) => t >= T.select + 0.05 && t < T.send)
  const imageChip = useAt((t) => t >= T.dropLogo && t < T.send)
  const fileChip = useAt((t) => t >= T.dropCsv && t < T.send)
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
              <Chip frame={FRAME} />
              <ImageChip name={KESTREL_FILE} />
              <FileChip name={GYMS_FILE} />
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
          <AssistantText>{FRAME} is Kestrel's now: their logo and orange, and all six gyms from the CSV with their real numbers. Click into a gym to try it.</AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 min-h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 pb-11 shadow-xs">
        {(frameChip || imageChip || fileChip) && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {frameChip && <Chip frame={FRAME} className="sm-pop" />}
            {imageChip && <ImageChip name={KESTREL_FILE} className="sm-pop" />}
            {fileChip && <FileChip name={GYMS_FILE} className="sm-pop" />}
          </div>
        )}
        <div className="pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {typing && n > 0 ? PROMPT.slice(0, n) : <span className="text-neutral-400">Ask me anything...</span>}
          {typing && n > 0 && <span className="sm-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
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

/** The two files the prospect sent: the logo and the gyms export. */
function Sources() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const logoLifted = useAt((t) => t >= T.grabLogo && t < T.dropLogo)
  const csvLifted = useAt((t) => t >= T.grabCsv && t < T.dropCsv)
  const swatches = useAt((t) => SWATCH_AT.filter((a) => t >= a).length)
  const scan = useAt((t) => (t >= SCAN[0] && t < SCAN[1] + 0.05 ? Math.round(ramp(t, SCAN[0], SCAN[1], E.linear) * 60) / 60 : -1))
  const lit = useAt((t) => GYMS.filter((_, i) => rowP(ramp(t, FILL[0], FILL[1], E.linear), i) >= 0.5).length)
  return (
    <motion.div style={{ opacity }}>
      <div className="absolute" style={{ left: LOGO.x, top: LOGO.y - 22 }}>
        <LogoTile swatches={swatches} lifted={logoLifted} />
      </div>
      <div className="absolute" style={{ left: SHEET.x, top: SHEET.y }}>
        <GymSheet scan={scan} lit={lit} lifted={csvLifted} />
      </div>
    </motion.div>
  )
}

/** Tally's Locations screen, re-skinned in place, then clicked into. */
function Dashboard() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const selected = useAt((t) => t >= T.select && t < T.send)
  const branded = useAt((t) => t >= FLY[1])
  const sweep = useAt((t) => Math.round(ramp(t, SWEEP[0], SWEEP[1], E.inOut) * 60) / 60)
  const fill = useAt((t) => Math.round(ramp(t, FILL[0], FILL[1], E.linear) * 60) / 60)
  const hover = useAt((t) => (t >= CLICK.row - 0.2 && t < BAR.at - 0.4 ? 0 : -1))
  const open = useAt((t) => (t >= CLICK.row ? 0 : -1))
  const drawer = useAt((t) => Math.round(ramp(t, DRAWER[0], DRAWER[1], E.out) * 60) / 60)
  const grow = useAt((t) => Math.round(ramp(t, GROW[0], GROW[1], E.out) * 60) / 60)
  const bar = useAt((t) => (t >= BAR.at ? PEAK : -1))
  return (
    <motion.div className="absolute font-sans" style={{ left: DASH.x, top: DASH.y - 22, width: DASH_W, opacity }}>
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">{FRAME}</div>
      <div className="relative overflow-hidden rounded-[10px] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.08]" style={{ height: DASH_H }}>
        <TallyLocations branded={branded} sweep={sweep} fill={fill} hover={hover} open={open} drawer={drawer} grow={grow} bar={bar} />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-[10px] transition-opacity duration-200" style={{ top: 22, boxShadow: `0 0 0 1.5px ${BLUE}`, opacity: selected ? 1 : 0 }} />
    </motion.div>
  )
}

/** A copy of Kestrel's mark, flying from the logo tile into the nav. */
function FlyingMark() {
  const shown = useAt((t) => t >= FLY[0] && t < FLY[1])
  const x = useTrack((t) => path(t, MARK_PATH)[0] - TILE_MARK_SIZE / 2)
  const y = useTrack((t) => path(t, MARK_PATH)[1] - TILE_MARK_SIZE / 2)
  const scale = useTrack((t) => kf(t, [[FLY[0], 1], [FLY[0] + 0.12, 1.06, E.out], [FLY[1], DASH_MARK_SIZE / TILE_MARK_SIZE, E.inOut]]))
  if (!shown) return null
  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-30 rounded-full shadow-[0_10px_24px_-10px_rgba(0,0,0,0.45)]" style={{ x, y, scale }}>
      <KestrelMark size={TILE_MARK_SIZE} />
    </motion.div>
  )
}

/** The file being dragged, following the pointer into the chat. */
function DragGhost() {
  const which = useAt((t) => (t >= T.grabLogo && t < T.dropLogo ? "logo" : t >= T.grabCsv && t < T.dropCsv ? "csv" : ""))
  const x = useTrack((t) => path(t, YOU)[0] + 10)
  const y = useTrack((t) => path(t, YOU)[1] + 12)
  const scale = useTrack((t) => {
    const g = t < T.grabCsv ? T.grabLogo : T.grabCsv
    return kf(t, [[g, 0.85], [g + 0.25, 1, E.pop]])
  })
  if (!which) return null
  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-40 rotate-[-2deg] rounded-md bg-[#2A2A2A] shadow-[0_8px_20px_-6px_rgba(0,0,0,0.5)]" style={{ x, y, scale }}>
      {which === "logo" ? <ImageChip name={KESTREL_FILE} /> : <FileChip name={GYMS_FILE} />}
    </motion.div>
  )
}

function Pointer() {
  const x = useTrack((t) => path(t, YOU)[0])
  const y = useTrack((t) => path(t, YOU)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6))
  const press = useTrack((t) => 1 - 0.16 * Math.max(...CLICKS.map((c) => Math.sin(Math.PI * ramp(t, c - 0.08, c + 0.12, E.linear))), dragging(t) ? 0.6 : 0))
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

export function UseCaseSalesMockupScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Chat />
        <Dashboard />
        <Sources />
        <FlyingMark />
        <DragGhost />
        <Pointer />
      </Fade>
      <style>{`@keyframes sm-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .sm-caret { animation: sm-caret 1s step-end infinite }
@keyframes sm-pop { from { opacity: 0; transform: scale(.85) } } .sm-pop { animation: sm-pop .25s cubic-bezier(.22,1,.36,1) both }`}</style>
    </Scene>
  )
}

export default function UseCaseSalesMockup() {
  return (
    <ScenePage label="Sales · Mockups with their data">
      <UseCaseSalesMockupScene />
    </ScenePage>
  )
}
