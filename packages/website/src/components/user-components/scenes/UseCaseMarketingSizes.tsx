/**
 * Marketers · "Every size, from one design": because it's code, one design
 * adapts. Ask for the square, the story and the banner, and each one lays
 * itself out instead of being redrawn.
 *
 * Same language as UseCasePMRealData, on a transparent stage:
 *   0–3.3s     LaunchAd (Lull 2's feed ad, 4:5) is on the canvas. The
 *              marketer selects it and asks: "Now the square, the story and
 *              a banner."
 *   3.6–7.7s   The agent reads LaunchAd and gives it a format prop. The ad
 *              steps back into a row, then three copies slide out from under
 *              it and morph into 9:16, 1:1 and a 728×90 leaderboard: the box
 *              reshapes first, then its contents re-lay out (the headline
 *              rewraps, the speaker moves, the CTA finds its corner, the
 *              banner goes flat and horizontal).
 *   8.1s       The reply.
 *   9.5–11.8s  The marketer changes the headline in chat.
 *   12.0–13.3s One edit in LaunchAd: the new line lands in all four at once,
 *              each wrapping it its own way, flashed as it lands. The reply.
 *   13.8s–     Held on the family of sizes, then a fade through the loop seam.
 *
 * Pieces: usecase/design/chat.tsx. Brand, ad and layouts: usecase/marketing/sizes.tsx.
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { BLUE, Cursor, E, Scene, ScenePage, kf, mix, path, ramp, typed, useAt, useTrack, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Chip, Reveal, ToolGroup, ToolRow } from "../usecase/design/chat"
import { HEADLINES, LAYS, LaunchAd, mixLay, type Format } from "../usecase/marketing/sizes"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 17
const STILL = 15.4

/* ── Timeline ─────────────────────────────────────────────────────────── */

const PROMPT = "Now the square, the story and a banner."
const PROMPT2 = `Headline: "${HEADLINES[1]}"`
const T = { select: 0.9, type: [1.4, 3.0] as const, send: 3.3, reply: 8.1 }
const T2 = { focus: 9.5, type: [9.8, 11.4] as const, send: 11.75, reply: 13.25 }

const ROWS = [
  { title: "Read LaunchAd.tsx", start: 3.6, done: 4.15 },
  { title: "Adding a format prop", start: 4.15, done: 5.3 },
  { title: "Laying out square, story, banner", start: 5.3, done: 7.75 },
]
const ROW2 = { title: "Editing the headline in LaunchAd", start: 12.0, done: 13.05 }

/** The original steps back into the row. */
const STEP_BACK = [4.35, 5.25] as const
/** Each copy: [start, end] of its morph out of the original. */
const MORPH: Record<Exclude<Format, "feed">, readonly [number, number]> = {
  story: [5.3, 7.0],
  square: [5.7, 7.35],
  banner: [6.1, 7.7],
}
/** The headline swap: dips out, the copy changes, back in; then the flash. */
const SWAP = [12.65, 12.85, 13.2] as const
const FLASH = [12.9, 13.15, 13.8] as const

/* ── Layout ───────────────────────────────────────────────────────────── */

const CHAT = { x: 72, y: 96, w: 300, h: 570 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]
const FOCUS_AT: [number, number] = [CHAT.x + 130, CHAT.y + CHAT.h - 62]

type Rect = { x: number; y: number; w: number; h: number }
const RECTS: Record<Format, Rect> = {
  feed: { x: 404, y: 178, w: 242, h: 302 },
  square: { x: 670, y: 178, w: 302, h: 302 },
  story: { x: 996, y: 178, w: 228, h: 405 },
  banner: { x: 404, y: 514, w: 568, h: Math.round((568 * 90) / 728) },
}
const SPEC: Record<Format, string> = { feed: "Feed · 1080×1350", square: "Square · 1080×1080", story: "Story · 1080×1920", banner: "Banner · 728×90" }

/** Where the original starts: the feed ad, larger, centred in the free stage. */
const BIG_S = 1.45
const BIG: Rect = { x: 814 - (RECTS.feed.w * BIG_S) / 2, y: 384 - (RECTS.feed.h * BIG_S) / 2, w: RECTS.feed.w * BIG_S, h: RECTS.feed.h * BIG_S }
const mixRect = (a: Rect, b: Rect, p: number): Rect => ({ x: mix(a.x, b.x, p), y: mix(a.y, b.y, p), w: mix(a.w, b.w, p), h: mix(a.h, b.h, p) })

const YOU: PathKey[] = [
  [0, 720, 668],
  [T.select - 0.5, 720, 668],
  [T.select - 0.05, 850, 330, E.inOut],
  [T.select + 0.2, 850, 330],
  [T.send - 0.55, 850, 330],
  [T.send - 0.1, ...SEND_AT, E.inOut],
  [T.send + 0.45, ...SEND_AT],
  [4.6, 470, 640, E.inOut],
  [T2.focus - 0.55, 470, 640],
  [T2.focus - 0.05, ...FOCUS_AT, E.inOut],
  [T2.focus + 0.2, ...FOCUS_AT],
  [T2.send - 0.5, ...FOCUS_AT],
  [T2.send - 0.1, ...SEND_AT, E.inOut],
  [T2.send + 0.4, ...SEND_AT],
  [13.7, 700, 650, E.inOut],
  [DUR, 700, 650],
]
const CLICKS = [T.select, T.send, T2.focus, T2.send]

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Chat() {
  const opacity = useTrack((t) => ramp(t, 0.2, 0.6))
  const n1 = useAt((t) => typed(t, T.type[0], T.type[1], PROMPT))
  const n2 = useAt((t) => typed(t, T2.type[0], T2.type[1], PROMPT2))
  const phase = useAt((t) => (t < T.send ? 1 : t < T2.send ? 2 : 3))
  const focused = useAt((t) => t >= T2.focus && t < T2.send)
  const press = useAt((t) => Math.round(Math.max(...[T.send, T2.send].map((s) => Math.sin(Math.PI * ramp(t, s - 0.08, s + 0.12, E.linear)))) * 10) / 10)
  const sent = useAt((t) => t >= T.send + 0.1)
  const sent2 = useAt((t) => t >= T2.send + 0.1)
  const frameChip = useAt((t) => t >= T.select + 0.05 && t < T.send)
  const shown = useAt((t) => ROWS.filter((r) => t >= r.start).length)
  const finished = useAt((t) => ROWS.filter((r) => t >= r.done).length)
  const row2 = useAt((t) => (t < ROW2.start ? 0 : t < ROW2.done ? 1 : 2))
  const reply = useAt((t) => t >= T.reply)
  const reply2 = useAt((t) => t >= T2.reply)
  const text = phase === 1 ? PROMPT.slice(0, n1) : phase === 2 ? PROMPT2.slice(0, n2) : ""
  const ready = text.length > 0
  return (
    <motion.div
      className="absolute flex flex-col overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#2A2A2A] font-sans shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)]"
      style={{ left: CHAT.x, top: CHAT.y, width: CHAT.w, height: CHAT.h, opacity }}
    >
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-3 pb-1">
        <Reveal on={sent}>
          <div className="flex flex-col items-end">
            <div className="flex flex-wrap justify-end gap-1.5 pb-1">
              <Chip frame="LaunchAd" />
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
          <AssistantText>LaunchAd now lays itself out for each size, so all four are one design. Change something and watch them follow.</AssistantText>
        </Reveal>
        <Reveal on={sent2}>
          <div className="flex flex-col items-end">
            <div className="max-w-[92%] rounded-[6px] bg-neutral-700 p-2 text-[13px] leading-[1.55] break-words whitespace-pre-wrap text-neutral-200">{PROMPT2}</div>
          </div>
        </Reveal>
        <Reveal on={row2 > 0}>
          <ToolGroup>
            <ToolRow title={ROW2.title} running={row2 === 1} />
          </ToolGroup>
        </Reveal>
        <Reveal on={reply2}>
          <AssistantText>Changed once, so all four have it.</AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 min-h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 pb-11 shadow-xs">
        {frameChip && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <Chip frame="LaunchAd" className="mz-pop" />
          </div>
        )}
        <div className="pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {ready ? text : focused ? null : <span className="text-neutral-400">Ask me anything...</span>}
          {(ready || focused) && phase < 3 && <span className="mz-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
        </div>
        <span className={cn("absolute right-2 bottom-2 grid size-7 place-items-center rounded-full bg-neutral-50 text-neutral-900", !ready && "opacity-50")} style={{ transform: `scale(${1 - press * 0.12})` }}>
          <ArrowUp className="size-3.5" />
        </span>
      </div>
    </motion.div>
  )
}

/** The headline every frame shows: the swap, its dip and the flash. */
function useHeadline() {
  const headline = useAt((t) => (t >= SWAP[1] ? HEADLINES[1] : HEADLINES[0]))
  const headOpacity = useTrack((t) => kf(t, [[SWAP[0], 1], [SWAP[1], 0, E.in], [SWAP[2], 1, E.out]]))
  const flash = useAt((t) => Math.round(kf(t, [[FLASH[0], 0], [FLASH[1], 1], [FLASH[2], 0]]) * 20) / 20)
  return { headline, headOpacity, flash }
}

/** A frame's name over its top-left corner: the component, then the size. */
function Label({ spec, on = true }: { spec: string; on?: boolean }) {
  return (
    <div className="absolute bottom-full left-0 mb-1.5 flex gap-1.5 pl-0.5 text-[11.5px] font-medium whitespace-nowrap transition-opacity duration-300" style={{ opacity: on ? 1 : 0 }}>
      <span className="text-white/55">LaunchAd</span>
      <span className="text-white/30">{spec}</span>
    </div>
  )
}

const FRAME = "absolute overflow-hidden rounded-[6px] shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)] ring-1 ring-white/[0.06]"

/** The original: large and centred, then it steps back into the row (scaled, so its layout holds). */
function Original() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const p = useAt((t) => Math.round(ramp(t, STEP_BACK[0], STEP_BACK[1], E.inOut) * 60) / 60)
  const selected = useAt((t) => t >= T.select && t < T.send)
  const r = mixRect(BIG, RECTS.feed, p)
  const { headline, headOpacity, flash } = useHeadline()
  return (
    <motion.div className="absolute font-sans" style={{ left: r.x, top: r.y, width: r.w, height: r.h, opacity }}>
      <Label spec={SPEC.feed} />
      <div className={FRAME} style={{ inset: 0 }}>
        <div className="origin-top-left" style={{ scale: r.w / RECTS.feed.w }}>
          <LaunchAd lay={LAYS.feed} w={RECTS.feed.w} h={RECTS.feed.h} headline={headline} headOpacity={headOpacity} flash={flash} />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0 rounded-[6px] transition-opacity duration-200" style={{ boxShadow: `0 0 0 1.5px ${BLUE}`, opacity: selected ? 1 : 0 }} />
    </motion.div>
  )
}

/**
 * A copy sliding out from under the original: the box reshapes first, then
 * its contents re-lay out for the new size (rendered at real size, so the
 * headline genuinely rewraps as the width changes).
 */
function Copy({ fmt }: { fmt: Exclude<Format, "feed"> }) {
  const [a, b] = MORPH[fmt]
  const box = useAt((t) => Math.round(ramp(t, a, b - 0.2, E.inOut) * 60) / 60)
  const inner = useAt((t) => Math.round(ramp(t, a + 0.3, b, E.inOut) * 60) / 60)
  const done = useAt((t) => t >= b - 0.1)
  const { headline, headOpacity, flash } = useHeadline()
  if (box <= 0) return null
  const r = mixRect(RECTS.feed, RECTS[fmt], box)
  return (
    <div className="absolute font-sans" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
      <Label spec={SPEC[fmt]} on={done} />
      <div className={FRAME} style={{ inset: 0 }}>
        <LaunchAd lay={mixLay(LAYS.feed, LAYS[fmt], inner)} w={r.w} h={r.h} headline={headline} headOpacity={headOpacity} flash={flash} />
      </div>
    </div>
  )
}

function Pointer() {
  const x = useTrack((t) => path(t, YOU)[0])
  const y = useTrack((t) => path(t, YOU)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6) * (1 - ramp(t, 14.8, 15.2)))
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

export function UseCaseMarketingSizesScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Chat />
        <Copy fmt="banner" />
        <Copy fmt="square" />
        <Copy fmt="story" />
        <Original />
        <Pointer />
      </Fade>
      <style>{`@keyframes mz-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .mz-caret { animation: mz-caret 1s step-end infinite }
@keyframes mz-pop { from { opacity: 0; transform: scale(.85) } } .mz-pop { animation: mz-pop .25s cubic-bezier(.22,1,.36,1) both }`}</style>
    </Scene>
  )
}

export default function UseCaseMarketingSizes() {
  return (
    <ScenePage label="Marketers · Every size, from one design">
      <UseCaseMarketingSizesScene />
    </ScenePage>
  )
}
