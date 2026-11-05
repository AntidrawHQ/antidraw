/**
 * Designers · "Build the controls you need": ask for the exact sliders,
 * swatches and toggles a design needs, then shape it by hand.
 *
 * Same language as UseCasePMRealData, on a transparent stage:
 *   0–3.9s    Halden Roasters' ProductCard is on the canvas: sharp 4px
 *             corners, Ink, compact, no badge. The designer selects it and
 *             asks for "controls for corner radius, accent colour and
 *             density, plus a toggle for the badge."
 *   4.1–6.6s  The agent reads the card and the brand tokens, then builds the
 *             controls: the card eases left and a bespoke panel docks beside
 *             it (shimmer, then Corners, Accent, Density and Badge land one
 *             by one). The reply.
 *   7.4–9.0s  The designer drags Corners 4 → 21, eases back to 16; the
 *             corners round live and the px readout follows.
 *   9.8–10.6s Tries Moss, settles on Ember; the label, eyebrow and button
 *             recolour.
 *   11.9s     Density to Airy: padding, gaps and the plate reflow.
 *   13.2s     The badge toggle: Fresh lot pops onto the plate.
 *   13.8s–    The pointer leaves; the hand-tuned card holds, then a fade
 *             through the loop seam.
 *
 * Pieces: usecase/design/chat.tsx. Card and panel: usecase/design/controls.tsx.
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { BLUE, Cursor, E, Scene, ScenePage, Skeleton, kf, path, ramp, typed, useAt, useTrack, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Chip, Reveal, ToolGroup, ToolRow } from "../usecase/design/chat"
import { ACCENTS, CARD_W, CardControls, PANEL_H, PANEL_HIT, PANEL_W, ProductCard } from "../usecase/design/controls"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 17
const STILL = 15.6

const FRAME = "ProductCard"
const PROMPT = "Give me controls for corner radius, accent colour and density, plus a toggle for the badge."
const T = { select: 0.8, focus: 1.25, type: [1.45, 3.45] as const, send: 3.85, reply: 6.6 }

const ROWS = [
  { title: `Read ${FRAME}.tsx`, start: 4.1, done: 4.55 },
  { title: "Read halden-tokens.ts · 4 accents", start: 4.55, done: 5.05 },
  { title: `Adding controls to ${FRAME}`, start: 5.05, done: 6.45 },
]

/* ── Layout ───────────────────────────────────────────────────────────── */

const CHAT = { x: 72, y: 96, w: 300, h: 570 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]
const INPUT_AT: [number, number] = [CHAT.x + 130, CHAT.y + CHAT.h - 62]

// The card starts centred on the open stage, then makes room for the panel.
const GAP = 20
const CARD_X = { from: 810 - CARD_W / 2, to: 812 - (CARD_W + GAP + PANEL_W) / 2 }
const PANEL = { x: CARD_X.to + CARD_W + GAP, y: Math.round(H / 2 + 12 - PANEL_H / 2) }
const panelPt = ([px, py]: readonly [number, number]): [number, number] => [PANEL.x + px, PANEL.y + py]

/* ── The build ────────────────────────────────────────────────────────── */

const MAKE_ROOM = [5.05, 5.75] as const
const DOCK = [5.3, 5.85] as const
const SHIMMER_OUT = [5.85, 6.1] as const
const ROW_IN = [0, 1, 2, 3].map((i) => 5.95 + i * 0.14)

/* ── The hand-tuning ──────────────────────────────────────────────────── */

const R = { from: 4, over: 21, to: 16 }
const DRAG = { grab: 7.45, over: 8.4, settle: 8.9, release: 9.0 }
const CLICK = { moss: 9.8, ember: 10.6, airy: 11.9, badge: 13.2 }
const AIRY = [11.95, 12.6] as const

const radius = (t: number) => kf(t, [[DRAG.grab, R.from], [DRAG.over, R.over, E.inOut], [DRAG.settle, R.to, E.inOut]])
const knob = (r: number) => panelPt(PANEL_HIT.knob(r))

const CARD_PT: [number, number] = [CARD_X.from + 170, 330]
const REST: [number, number] = [1010, 640]

const YOU: PathKey[] = [
  [0, 960, 650],
  [T.select - 0.45, 960, 650],
  [T.select - 0.05, ...CARD_PT, E.inOut],
  [T.select + 0.1, ...CARD_PT],
  [T.focus - 0.05, ...INPUT_AT, E.inOut],
  [T.send - 0.45, ...INPUT_AT],
  [T.send - 0.1, ...SEND_AT, E.inOut],
  [T.send + 0.4, ...SEND_AT],
  [6.3, ...REST, E.inOut],
  [DRAG.grab - 0.55, ...REST],
  [DRAG.grab - 0.1, ...knob(R.from), E.inOut],
  [DRAG.grab, ...knob(R.from)],
  [DRAG.over, ...knob(R.over), E.inOut, true],
  [DRAG.settle, ...knob(R.to), E.inOut, true],
  [DRAG.release + 0.1, ...knob(R.to)],
  [CLICK.moss - 0.1, ...panelPt(PANEL_HIT.swatch(1)), E.inOut],
  [CLICK.moss + 0.2, ...panelPt(PANEL_HIT.swatch(1))],
  [CLICK.ember - 0.1, ...panelPt(PANEL_HIT.swatch(2)), E.inOut],
  [CLICK.ember + 0.25, ...panelPt(PANEL_HIT.swatch(2))],
  [CLICK.airy - 0.1, ...panelPt(PANEL_HIT.seg(2)), E.inOut],
  [CLICK.airy + 0.25, ...panelPt(PANEL_HIT.seg(2))],
  [CLICK.badge - 0.1, ...panelPt(PANEL_HIT.toggle), E.inOut],
  [CLICK.badge + 0.3, ...panelPt(PANEL_HIT.toggle)],
  [14.4, 1150, 610, E.inOut],
  [DUR, 1150, 610],
]
const CLICKS = [T.select, T.focus, T.send, CLICK.moss, CLICK.ember, CLICK.airy, CLICK.badge]

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Chat() {
  const opacity = useTrack((t) => ramp(t, 0.2, 0.6))
  const typing = useAt((t) => t < T.send)
  const n = useAt((t) => typed(t, T.type[0], T.type[1], PROMPT))
  const focus = useAt((t) => t >= T.focus && t < T.send)
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
              <Chip frame={FRAME} />
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
            {FRAME} now has its own controls panel: corners, your four brand accents, three densities and the Fresh lot badge, all live on the card. Have a play.
          </AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 min-h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 pb-11 shadow-xs">
        {frameChip && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            <Chip frame={FRAME} className="dc-pop" />
          </div>
        )}
        <div className="pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {typing && n > 0 ? PROMPT.slice(0, n) : !focus && <span className="text-neutral-400">Ask me anything...</span>}
          {focus && <span className="dc-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
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

/** The values both the card and the panel read. */
function useTuning() {
  const r = useAt((t) => Math.round(radius(t)))
  const accent = useAt((t) => (t >= CLICK.ember ? 2 : t >= CLICK.moss ? 1 : 0))
  const density = useAt((t) => Math.round(kf(t, [[AIRY[0], 0], [AIRY[1], 2, E.inOut]]) * 60) / 60)
  const segment = useAt((t) => (t >= CLICK.airy ? 2 : 0))
  const badge = useAt((t) => t >= CLICK.badge)
  return { r, accent, density, segment, badge }
}

function Card() {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const x = useTrack((t) => kf(t, [[MAKE_ROOM[0], CARD_X.from], [MAKE_ROOM[1], CARD_X.to, E.inOut]]))
  const selected = useAt((t) => t >= T.select && t < T.send)
  const { r, accent, density, badge } = useTuning()
  return (
    <motion.div className="absolute top-0 left-0 flex flex-col justify-center font-sans" style={{ x, height: H, width: CARD_W, opacity }}>
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">{FRAME}</div>
      <div className="relative">
        <ProductCard r={r} accent={ACCENTS[accent].hex} density={density} badge={badge} />
        <div className="pointer-events-none absolute inset-0 transition-opacity duration-200" style={{ borderRadius: r, boxShadow: `0 0 0 1.5px ${BLUE}`, opacity: selected ? 1 : 0 }} />
      </div>
    </motion.div>
  )
}

function Panel() {
  const shown = useAt((t) => t >= DOCK[0])
  const opacity = useTrack((t) => ramp(t, DOCK[0], DOCK[1], E.out))
  const x = useTrack((t) => -28 * (1 - ramp(t, DOCK[0], DOCK[1], E.out)))
  const shimmer = useTrack((t) => 1 - ramp(t, SHIMMER_OUT[0], SHIMMER_OUT[1]))
  const shimmerOn = useAt((t) => t < SHIMMER_OUT[1])
  const reveal = useAt((t) => ROW_IN.map((a) => Math.round(ramp(t, a, a + 0.35, E.out) * 30) / 30).join(","))
  const grab = useAt((t) => t >= DRAG.grab && t < DRAG.release)
  const { r, accent, segment, badge } = useTuning()
  if (!shown) return null
  return (
    <motion.div className="absolute" style={{ left: PANEL.x, top: PANEL.y, x, opacity }}>
      <CardControls r={r} accent={accent} density={segment} badge={badge} grab={grab} reveal={reveal.split(",").map(Number)} />
      {shimmerOn && (
        <motion.div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[12px]" style={{ opacity: shimmer }}>
          <Skeleton />
        </motion.div>
      )}
    </motion.div>
  )
}

function Pointer() {
  const x = useTrack((t) => path(t, YOU)[0])
  const y = useTrack((t) => path(t, YOU)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6) * (1 - ramp(t, 14.2, 14.7)))
  const press = useTrack((t) => 1 - 0.16 * Math.max(...CLICKS.map((c) => Math.sin(Math.PI * ramp(t, c - 0.08, c + 0.12, E.linear))), t >= DRAG.grab && t < DRAG.release ? 0.6 : 0))
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

export function UseCaseDesignControlsScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Chat />
        <Card />
        <Panel />
        <Pointer />
      </Fade>
      <style>{`@keyframes dc-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .dc-caret { animation: dc-caret 1s step-end infinite }
@keyframes dc-pop { from { opacity: 0; transform: scale(.85) } } .dc-pop { animation: dc-pop .25s cubic-bezier(.22,1,.36,1) both }`}</style>
    </Scene>
  )
}

export default function UseCaseDesignControls() {
  return (
    <ScenePage label="Designers · Build the controls you need">
      <UseCaseDesignControlsScene />
    </ScenePage>
  )
}
