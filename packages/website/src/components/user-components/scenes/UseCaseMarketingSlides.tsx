/**
 * Marketers · "Slides made of real components": launch decks built from the
 * actual product and brand, animated where you want it, and never out of
 * date with the app.
 *
 * Same language as UseCasePMRealData, on a transparent stage:
 *   0–3.5s     Tally's brand frame and its real SalesChart sit on the canvas.
 *              The marketer selects SalesChart (a chip lands) and asks for "a
 *              five-slide launch deck for Thursday's webinar, in our brand,
 *              with this chart live in it."
 *   3.7–6.6s   The agent reads the brand and the chart, then writes
 *              LaunchDeck: the viewer opens on a skeleton, five thumbnails
 *              land one by one, and the title slide animates in (the
 *              headline rises, Tally's four-and-a-slash marks draw).
 *   6.7s       The reply.
 *   7.2–12.1s  The marketer clicks through: › wipes into slide 2 ("2 in 5"
 *              stores short at lunch, two store tiles light amber); › again
 *              match-cuts into slide 3, where the live SalesChart rises and
 *              its bars grow. They hover 12p (the bar lights, a tooltip
 *              shows $1,840 · 212 orders), then switch it to "4-wk avg" and
 *              the bars and total re-settle, inside the slide.
 *   12.5–15.5s "Add the forecast line to SalesChart." The agent edits
 *              SalesChart.tsx; the dashed amber line draws on the canvas
 *              chart and on slide 3 at once (and in its thumbnail), since
 *              the slide renders the same component. The reply.
 *   15.5s–     Held, then a fade through the loop seam.
 *
 * Pieces: usecase/design/chat.tsx. Brand, chart and deck:
 * usecase/marketing/launchdeck.tsx (TallyMark from usecase/sales/demo.tsx).
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion, type MotionValue } from "motion/react"

import { cn } from "@/lib/utils"
import { BLUE, Cursor, E, Scene, ScenePage, kf, path, ramp, typed, useAt, useTrack, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Chip, Reveal, ToolGroup, ToolRow } from "../usecase/design/chat"
import {
  BRAND_H,
  BRAND_W,
  CHART_AVG_AT,
  CHART_BAR_AT,
  CHART_H,
  CHART_W,
  DECK_H,
  DECK_NEXT_AT,
  DECK_SLIDE,
  DECK_W,
  HOVER_BAR,
  LaunchDeck,
  SLIDE_CHART,
  SalesChart,
  TallyBrand,
} from "../usecase/marketing/launchdeck"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 18
const STILL = 16.6

const PROMPT1 = "A five-slide launch deck for Thursday's webinar, in our brand, with this chart live in it."
const PROMPT2 = "Add the forecast line to SalesChart."
const T = {
  select: 0.9,
  type1: [1.3, 3.15] as const,
  send1: 3.5,
  reply1: 6.7,
  next1: 7.2,
  next2: 8.8,
  avg: 11.45,
  compose: 12.55,
  type2: [12.7, 13.55] as const,
  send2: 13.9,
  reply2: 15.2,
}

const ROWS1 = [
  { title: "Read TallyBrand and SalesChart", start: 3.75, done: 4.55 },
  { title: "Writing LaunchDeck · 5 slides", start: 4.55, done: 6.0 },
  { title: "Put the live SalesChart on slide 3", start: 6.0, done: 6.55 },
]
const ROWS2 = [{ title: "Edit SalesChart.tsx · forecast line", start: 14.1, done: 14.75 }]

/* ── Layout ───────────────────────────────────────────────────────────── */

const CHAT = { x: 80, y: 74, w: 300, h: 602 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]
const COMPOSE_AT: [number, number] = [CHAT.x + 130, CHAT.y + CHAT.h - 64]

const RX = CHAT.x + CHAT.w + 48
const BRAND = { x: RX, y: CHAT.y, w: BRAND_W, h: BRAND_H }
const CS = 0.66
const SALES = { x: RX + BRAND_W + 24, y: CHAT.y, w: CHART_W * CS, h: CHART_H * CS }
const DECK = { x: RX, y: CHAT.y + CHAT.h - DECK_H, w: DECK_W, h: DECK_H }

const NEXT_AT: [number, number] = [DECK.x + DECK_NEXT_AT[0], DECK.y + DECK_NEXT_AT[1]]
/** A point in slide 3's SalesChart (chart px) → stage. */
const chartPt = ([cx, cy]: readonly [number, number]): [number, number] => [
  DECK.x + DECK_SLIDE.x + (SLIDE_CHART.x + cx * SLIDE_CHART.s) * DECK_SLIDE.s,
  DECK.y + DECK_SLIDE.y + (SLIDE_CHART.y + cy * SLIDE_CHART.s) * DECK_SLIDE.s,
]

/* ── The deck's beats ─────────────────────────────────────────────────── */

const READ = [3.8, 4.05] as const
const DECK_IN = [4.55, 4.85] as const
const THUMB_AT = [4.9, 5.12, 5.34, 5.56, 5.78]
const READY = [5.45, 5.65] as const
const ENTER = [
  [5.5, 6.7],
  [7.45, 8.45],
  [8.95, 9.75],
] as const
const TR = [
  [7.25, 7.95],
  [8.85, 9.55],
] as const
const GROW = [9.4, 10.3] as const
const HOVER = [10.2, 11.05] as const
const AVG = [11.5, 12.1] as const
const FC = [14.75, 15.45] as const

const YOU: PathKey[] = [
  [0, 1010, 470],
  [T.select - 0.5, 1010, 470],
  [T.select - 0.05, SALES.x + 230, SALES.y + 104, E.inOut],
  [T.select + 0.15, SALES.x + 230, SALES.y + 104],
  [T.send1 - 0.5, SALES.x + 230, SALES.y + 104],
  [T.send1 - 0.1, ...SEND_AT, E.inOut],
  [T.send1 + 0.4, ...SEND_AT],
  [6.4, NEXT_AT[0] - 40, NEXT_AT[1] + 30, E.inOut],
  [T.next1 - 0.5, NEXT_AT[0] - 40, NEXT_AT[1] + 30],
  [T.next1 - 0.08, ...NEXT_AT, E.inOut],
  [T.next2 + 0.3, ...NEXT_AT],
  [HOVER[0] + 0.05, ...chartPt(CHART_BAR_AT(HOVER_BAR)), E.inOut],
  [HOVER[1] - 0.1, ...chartPt(CHART_BAR_AT(HOVER_BAR))],
  [T.avg - 0.08, ...chartPt(CHART_AVG_AT), E.inOut],
  [T.avg + 0.4, ...chartPt(CHART_AVG_AT)],
  [T.compose - 0.08, ...COMPOSE_AT, E.inOut],
  [T.compose + 0.2, ...COMPOSE_AT],
  [T.send2 - 0.45, ...COMPOSE_AT],
  [T.send2 - 0.08, ...SEND_AT, E.inOut],
  [T.send2 + 0.4, ...SEND_AT],
  [15.1, SEND_AT[0] + 70, SEND_AT[1] - 40, E.inOut],
  [DUR, SEND_AT[0] + 70, SEND_AT[1] - 40],
]
const CLICKS = [T.select, T.send1, T.next1, T.next2, T.avg, T.compose, T.send2]

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Chat() {
  const opacity = useTrack((t) => ramp(t, 0.2, 0.6))
  const draft = useAt((t) => (t < T.send1 ? 1 : t >= T.compose && t < T.send2 ? 2 : 0))
  const n = useAt((t) => (t < T.send1 ? typed(t, T.type1[0], T.type1[1], PROMPT1) : typed(t, T.type2[0], T.type2[1], PROMPT2)))
  const press = useAt((t) => Math.round(Math.max(...[T.send1, T.send2].map((s) => Math.sin(Math.PI * ramp(t, s - 0.08, s + 0.12, E.linear)))) * 10) / 10)
  const sent1 = useAt((t) => t >= T.send1 + 0.1)
  const sent2 = useAt((t) => t >= T.send2 + 0.1)
  const chip = useAt((t) => t >= T.select + 0.05 && t < T.send1)
  const shown1 = useAt((t) => ROWS1.filter((r) => t >= r.start).length)
  const done1 = useAt((t) => ROWS1.filter((r) => t >= r.done).length)
  const shown2 = useAt((t) => ROWS2.filter((r) => t >= r.start).length)
  const done2 = useAt((t) => ROWS2.filter((r) => t >= r.done).length)
  const reply1 = useAt((t) => t >= T.reply1)
  const reply2 = useAt((t) => t >= T.reply2)
  const text = draft === 1 ? PROMPT1 : draft === 2 ? PROMPT2 : ""
  const typing = draft > 0
  return (
    <motion.div
      className="absolute flex flex-col overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#2A2A2A] font-sans shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)]"
      style={{ left: CHAT.x, top: CHAT.y, width: CHAT.w, height: CHAT.h, opacity }}
    >
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-3 pb-1">
        <Reveal on={sent1}>
          <div className="flex flex-col items-end">
            <div className="flex flex-wrap justify-end gap-1.5 pb-1">
              <Chip frame="SalesChart" />
            </div>
            <div className="max-w-[92%] rounded-[6px] bg-neutral-700 p-2 text-[13px] leading-[1.55] break-words whitespace-pre-wrap text-neutral-200">{PROMPT1}</div>
          </div>
        </Reveal>
        <Reveal on={shown1 > 0}>
          <ToolGroup>
            {ROWS1.slice(0, Math.max(1, shown1)).map((r, i) => (
              <ToolRow key={i} title={r.title} running={i >= done1} />
            ))}
          </ToolGroup>
        </Reveal>
        <Reveal on={reply1}>
          <AssistantText>LaunchDeck has five slides in Tally’s type and colours, and slide 3 runs the real SalesChart, so it’s live. Click through it.</AssistantText>
        </Reveal>
        <Reveal on={sent2}>
          <div className="flex flex-col items-end">
            <div className="max-w-[92%] rounded-[6px] bg-neutral-700 p-2 text-[13px] leading-[1.55] break-words whitespace-pre-wrap text-neutral-200">{PROMPT2}</div>
          </div>
        </Reveal>
        <Reveal on={shown2 > 0}>
          <ToolGroup>
            {ROWS2.map((r, i) => (
              <ToolRow key={i} title={r.title} running={i >= done2} />
            ))}
          </ToolGroup>
        </Reveal>
        <Reveal on={reply2}>
          <AssistantText>Done. Slide 3 renders the same SalesChart, so the deck has the forecast too.</AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 min-h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 pb-11 shadow-xs">
        {chip && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <Chip frame="SalesChart" className="ms-pop" />
          </div>
        )}
        <div className="pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {typing && n > 0 ? text.slice(0, n) : <span className="text-neutral-400">Ask me anything...</span>}
          {typing && <span className="ms-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
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

/** A frame on the stage: its name above, the component, the selection ring. */
function Framed({ name, box, selected = false, flash, children }: { name: string; box: { x: number; y: number; w: number; h: number }; selected?: boolean; flash?: MotionValue<number>; children: ReactNode }) {
  return (
    <div className="absolute font-sans" style={{ left: box.x, top: box.y - 22, width: box.w }}>
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">{name}</div>
      <div className="relative overflow-hidden rounded-[10px] shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)]" style={{ height: box.h }}>
        {children}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-[10px] transition-opacity duration-200" style={{ top: 22, boxShadow: `0 0 0 1.5px ${BLUE}`, opacity: selected ? 1 : 0 }} />
      {flash && <motion.div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-[10px]" style={{ top: 22, boxShadow: `0 0 0 1.5px ${BLUE}`, opacity: flash }} />}
    </div>
  )
}

function Canvas() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const selected = useAt((t) => t >= T.select && t < T.send1)
  const forecast = useAt((t) => Math.round(ramp(t, FC[0], FC[1], E.inOut) * 60) / 60)
  // The agent reads each frame (a soft outline passes over them), and later
  // its edit lands on the source component: the same outline as it re-renders.
  const read = (a: number) => (t: number) => kf(t, [[a, 0], [a + 0.15, 0.7], [a + 0.55, 0]])
  const brandFlash = useTrack(read(READ[0]))
  const flash = useTrack((t) => (t < 10 ? read(READ[1])(t) : kf(t, [[FC[0] - 0.15, 0], [FC[0] + 0.1, 0.9], [FC[1] + 0.4, 0]])))
  return (
    <motion.div className="absolute inset-0" style={{ opacity }}>
      <Framed name="TallyBrand" box={BRAND} flash={brandFlash}>
        <TallyBrand />
      </Framed>
      <Framed name="SalesChart" box={SALES} selected={selected} flash={flash}>
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `scale(${CS})` }}>
          <SalesChart forecast={forecast} />
        </div>
      </Framed>
    </motion.div>
  )
}

const q = (v: number) => Math.round(v * 60) / 60
/** Which slide is up: each › starts its transition. */
const slideAt = (t: number) => (t < TR[0][0] ? 0 : t < TR[1][0] ? 1 : 2)

function Deck() {
  const opacity = useTrack((t) => ramp(t, DECK_IN[0], DECK_IN[1]))
  const shown = useAt((t) => t >= DECK_IN[0])
  const thumbs = useAt((t) => THUMB_AT.filter((a) => t >= a).length)
  const ready = useAt((t) => q(ramp(t, READY[0], READY[1])))
  const cur = useAt(slideAt)
  const p = useAt((t) => (slideAt(t) === 0 ? 1 : q(ramp(t, TR[slideAt(t) - 1][0], TR[slideAt(t) - 1][1], E.linear))))
  const enter = useAt((t) => q(ramp(t, ENTER[slideAt(t)][0], ENTER[slideAt(t)][1], E.linear)))
  const grow = useAt((t) => q(ramp(t, GROW[0], GROW[1], E.linear)))
  const hover = useAt((t) => (t >= HOVER[0] && t < HOVER[1] ? HOVER_BAR : -1))
  const avg = useAt((t) => q(ramp(t, AVG[0], AVG[1], E.inOut)))
  const forecast = useAt((t) => q(ramp(t, FC[0], FC[1], E.inOut)))
  const press = useAt((t) => Math.round(Math.max(...[T.next1, T.next2].map((s) => Math.sin(Math.PI * ramp(t, s - 0.08, s + 0.12, E.linear)))) * 10) / 10)
  if (!shown) return null
  return (
    <motion.div className="absolute font-sans" style={{ left: DECK.x, top: DECK.y - 22, width: DECK.w, opacity }}>
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">LaunchDeck</div>
      <div className="relative overflow-hidden rounded-[10px] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.08]" style={{ height: DECK.h }}>
        <LaunchDeck thumbs={thumbs} ready={ready} cur={cur} prev={Math.max(0, cur - 1)} p={p} enter={enter} chart={{ grow, hover, avg, forecast }} press={press} />
      </div>
    </motion.div>
  )
}

function Pointer() {
  const x = useTrack((t) => path(t, YOU)[0])
  const y = useTrack((t) => path(t, YOU)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6) * (1 - ramp(t, 16.0, 16.4)))
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

export function UseCaseMarketingSlidesScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Chat />
        <Canvas />
        <Deck />
        <Pointer />
      </Fade>
      <style>{`@keyframes ms-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .ms-caret { animation: ms-caret 1s step-end infinite }
@keyframes ms-pop { from { opacity: 0; transform: scale(.85) } } .ms-pop { animation: ms-pop .25s cubic-bezier(.22,1,.36,1) both }`}</style>
    </Scene>
  )
}

export default function UseCaseMarketingSlides() {
  return (
    <ScenePage label="Marketers · Slides made of real components">
      <UseCaseMarketingSlidesScene />
    </ScenePage>
  )
}
