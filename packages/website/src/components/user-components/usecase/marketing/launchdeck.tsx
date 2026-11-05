/**
 * "Slides made of real components" pieces, in the brand of Tally (the made-up
 * sales & staffing dashboard the sales scenes sell; TallyMark from
 * usecase/sales/demo.tsx):
 *
 *  - TallyBrand  the brand frame on the canvas: mark, four colours, type
 *  - SalesChart  Tally's real "Sales by hour" card. One layout (600×240),
 *                scaled to wherever it sits, so the canvas frame and slide 3
 *                render the same component. Props drive the bars growing in,
 *                a hovered hour, Today ↔ 4-wk avg, and a forecast line.
 *  - LaunchDeck  the deck the agent builds: a dark viewer with a thumbnail
 *                strip, the current slide, and ‹ n / 5 ›. Slides are 960×540
 *                and animate in by an `enter` prop (0→1); the viewer plays a
 *                wipe into slide 2 and a match-cut into slide 3.
 *
 * CHART_*, SLIDE_* and DECK_* points are in each piece's own px.
 */
import type { CSSProperties, ReactNode } from "react"
import { ChevronLeft, ChevronRight, Store } from "lucide-react"

import { cn } from "@/lib/utils"
import { E, Skeleton } from "../../motion/canvas-ai/kit"
import { TallyMark } from "../sales/demo"

const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const mix = (a: number, b: number, p: number) => a + (b - a) * p
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`

/* ── Brand ──────────────────────────────────────────────────────────────── */

export const TALLY = { indigo: "#4f46e5", ink: "#16161f", paper: "#f6f6f8", amber: "#f5a524", soft: "#dcdafb", line: "#e6e6ec", muted: "#77778a" }
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace"

const SWATCHES = [
  { name: "Indigo", hex: "#4F46E5" },
  { name: "Ink", hex: "#16161F" },
  { name: "Paper", hex: "#F6F6F8" },
  { name: "Amber", hex: "#F5A524" },
]
export const BRAND_W = 352
export const BRAND_H = 158

/** Tally's brand tokens, as a frame on the canvas. */
export function TallyBrand() {
  return (
    <div className="absolute inset-0 flex flex-col bg-white px-4 pt-3.5 font-sans" style={{ color: TALLY.ink }}>
      <div className="flex items-center gap-2">
        <TallyMark size={20} />
        <span className="text-[15px] font-semibold tracking-[-0.02em]">Tally</span>
        <span className="ml-auto font-mono text-[10px] text-black/40">brand · v3.2</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {SWATCHES.map((s) => (
          <div key={s.name}>
            <div className="h-[38px] rounded-[6px] ring-1 ring-black/[0.07] ring-inset" style={{ background: s.hex }} />
            <div className="mt-1 text-[10.5px] leading-tight font-medium">{s.name}</div>
            <div className="font-mono text-[9px] leading-tight text-black/40">{s.hex}</div>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-baseline gap-2 border-t border-black/[0.06] pt-2">
        <span className="text-[17px] leading-none font-semibold tracking-[-0.04em]">Aa</span>
        <span className="text-[10.5px] text-black/50">SF Pro Display · Semibold · −4% tracking</span>
      </div>
    </div>
  )
}

/* ── SalesChart ─────────────────────────────────────────────────────────── */

const HOURS = ["6a", "7a", "8a", "9a", "10a", "11a", "12p", "1p", "2p", "3p", "4p", "5p"]
/** Saturday, Oct 17, across five stores (adds up to $12,480, Tally's "Sales today"). */
const TODAY = [380, 690, 1080, 1340, 1210, 1560, 1840, 1590, 1060, 760, 560, 410]
/** The last four Saturdays, averaged ($13,010). */
const AVG = [350, 640, 1010, 1300, 1390, 1710, 1960, 1650, 1120, 820, 610, 450]
/** Next Saturday, forecast. */
const FORECAST = [370, 700, 1100, 1420, 1480, 1820, 2120, 1760, 1180, 850, 640, 470]
const ORDERS = [44, 81, 124, 150, 141, 178, 212, 183, 122, 88, 65, 47]
const MAX = 2200

export const CHART_W = 600
export const CHART_H = 240
const PAD = 20
const BARS_TOP = 84
const BARS_BOT = 200
const BAR_H = BARS_BOT - BARS_TOP
const GAP = 8
const BW = (CHART_W - PAD * 2 - GAP * 11) / 12
const barX = (i: number) => PAD + i * (BW + GAP)
const SEG = { w: 172, h: 28, y: 18 }
const SEG_X = CHART_W - PAD - SEG.w

/** The hour the scene hovers (12p, the lunch peak). */
export const HOVER_BAR = 6
/** The middle of a bar (Today's height) and the "4-wk avg" half of the toggle, in chart px. */
export const CHART_BAR_AT = (i: number): [number, number] => [barX(i) + BW / 2, BARS_BOT - ((TODAY[i] / MAX) * BAR_H) / 2]
export const CHART_AVG_AT: [number, number] = [SEG_X + (SEG.w * 3) / 4, SEG.y + SEG.h / 2]

/**
 * `grow` 0→1 raises the bars (staggered); `hover` is the hovered bar or -1;
 * `avg` 0→1 morphs Today into the 4-week average; `forecast` 0→1 draws the
 * forecast line left to right (and shows its legend).
 */
export function SalesChart({ grow = 1, hover = -1, avg = 0, forecast = 0 }: { grow?: number; hover?: number; avg?: number; forecast?: number }) {
  const vals = TODAY.map((v, i) => mix(v, AVG[i], avg))
  const total = vals.reduce((s, v) => s + v, 0)
  const pts = FORECAST.map((v, i) => `${barX(i) + BW / 2},${BARS_BOT - (v / MAX) * BAR_H}`).join(" ")
  const legend = c01(forecast * 4)
  return (
    <div className="absolute top-0 left-0 overflow-hidden rounded-[12px] border bg-white font-sans" style={{ width: CHART_W, height: CHART_H, borderColor: TALLY.line, color: TALLY.ink }}>
      <div className="absolute top-[18px] left-5 text-[13px] font-semibold">Sales by hour</div>
      <div className="absolute top-[38px] left-5 flex items-baseline gap-2">
        <span className="text-[26px] leading-none font-semibold tracking-[-0.03em] tabular-nums">{money(Math.round(total / 10) * 10)}</span>
        <span className="text-[12px]" style={{ color: TALLY.muted }}>
          {avg < 0.5 ? "Sat, Oct 17 · 5 stores" : "Last 4 Saturdays · 5 stores"}
        </span>
      </div>
      {/* Today | 4-wk avg, with a sliding pill */}
      <div className="absolute rounded-[8px] p-[3px]" style={{ left: SEG_X, top: SEG.y, width: SEG.w, height: SEG.h, background: "#f0f0f4" }}>
        <div className="absolute top-[3px] bottom-[3px] rounded-[6px] bg-white shadow-[0_1px_2px_rgba(22,22,31,0.12)]" style={{ left: 3 + avg * (SEG.w / 2 - 3), width: SEG.w / 2 - 3 }} />
        {["Today", "4-wk avg"].map((s, i) => (
          <span key={s} className="absolute top-0 grid h-full place-items-center text-[12px] font-semibold" style={{ left: (i * SEG.w) / 2, width: SEG.w / 2, color: (i === 1) === avg >= 0.5 ? TALLY.ink : TALLY.muted }}>
            {s}
          </span>
        ))}
      </div>
      <div className="absolute flex items-center gap-1.5 text-[11.5px] font-medium" style={{ right: PAD, top: 56, opacity: legend, color: "#b86e00" }}>
        <svg width="18" height="4" className="overflow-visible">
          <line x1="0" y1="2" x2="18" y2="2" stroke={TALLY.amber} strokeWidth="2.25" strokeDasharray="5 3" strokeLinecap="round" />
        </svg>
        Forecast · next Sat
      </div>
      {vals.map((v, i) => {
        const g = E.out(c01((grow - i * 0.035) / 0.6))
        const h = (v / MAX) * BAR_H * g
        return (
          <div key={i}>
            <div className="absolute rounded-[5px]" style={{ left: barX(i), width: BW, top: BARS_BOT - h, height: h, background: hover === i ? TALLY.indigo : TALLY.soft }} />
            <span className="absolute text-center text-[10.5px]" style={{ left: barX(i), width: BW, top: BARS_BOT + 6, color: hover === i ? TALLY.ink : TALLY.muted, fontWeight: hover === i ? 600 : 400 }}>
              {HOURS[i]}
            </span>
          </div>
        )
      })}
      {forecast > 0 && (
        <svg className="absolute inset-0" width={CHART_W} height={CHART_H} style={{ clipPath: `inset(0 ${(1 - forecast) * 100}% 0 0)` }}>
          <polyline points={pts} fill="none" stroke={TALLY.amber} strokeWidth="2.5" strokeDasharray="7 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {hover >= 0 && (
        <div
          className="ld-pop absolute rounded-[8px] px-2.5 py-1.5 text-white shadow-[0_6px_16px_-6px_rgba(22,22,31,0.45)]"
          style={{ left: barX(hover) + BW + 8, top: BARS_BOT - (vals[hover] / MAX) * BAR_H + 4, background: TALLY.ink }}
        >
          <div className="text-[10.5px] text-white/55">{HOURS[hover]} – {HOURS[hover + 1]}</div>
          <div className="text-[14px] leading-tight font-semibold tabular-nums">{money(vals[hover])}</div>
          <div className="text-[10.5px] text-white/55 tabular-nums">{ORDERS[hover]} orders</div>
        </div>
      )}
      <style>{`@keyframes ld-pop { from { opacity: 0; transform: translateY(3px) } } .ld-pop { animation: ld-pop .2s cubic-bezier(.22,1,.36,1) both }`}</style>
    </div>
  )
}

/* ── Slides (960×540) ───────────────────────────────────────────────────── */

export const SLIDE_W = 960
export const SLIDE_H = 540
/** Where slide 3 puts SalesChart, in slide px, and its scale. */
export const SLIDE_CHART = { x: 56, y: 150, s: 848 / CHART_W }

/** Fade-and-rise for a piece of a slide that starts `d` into its `enter`. */
const rise = (enter: number, d: number, dist = 18): CSSProperties => {
  const p = E.out(c01((enter - d) / 0.5))
  return { opacity: p, transform: `translateY(${(1 - p) * dist}px)` }
}

export type ChartState = { grow: number; hover: number; avg: number; forecast: number }

const Label = ({ children, dark, style }: { children: ReactNode; dark?: boolean; style?: CSSProperties }) => (
  <div className="absolute top-[46px] left-14 text-[12.5px] font-medium tracking-[0.14em]" style={{ fontFamily: MONO, color: dark ? "rgba(255,255,255,0.5)" : "rgba(22,22,31,0.45)", ...style }}>
    {children}
  </div>
)

/** The paper slides share this footer, so it holds still through a match-cut. */
const Foot = ({ n, dark }: { n: number; dark?: boolean }) => (
  <div className="absolute inset-x-14 bottom-[22px] flex items-center justify-between text-[13px]" style={{ color: dark ? "rgba(255,255,255,0.45)" : "rgba(22,22,31,0.4)" }}>
    <span className="flex items-center gap-2">
      <TallyMark size={16} />
      Tally · Fall launch webinar
    </span>
    <span className="tabular-nums" style={{ fontFamily: MONO }}>
      {String(n).padStart(2, "0")}
    </span>
  </div>
)

/** Four strokes and a slash: Tally's mark, drawn big. `draw` 0→1 puts the strokes down in order. */
function TallyMarks({ draw, color, size = 220, style }: { draw: number; color: string; size?: number; style?: CSSProperties }) {
  const strokes = [
    [28, 20, 28, 200],
    [72, 20, 72, 200],
    [116, 20, 116, 200],
    [160, 20, 160, 200],
    [196, 44, 6, 176],
  ]
  return (
    <svg width={size} height={size} viewBox="0 0 220 220" fill="none" className="absolute" style={style}>
      {strokes.map(([x1, y1, x2, y2], i) => {
        const p = E.inOut(c01((draw - i * 0.14) / 0.36))
        const len = Math.hypot(x2 - x1, y2 - y1)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="16" strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - p)} opacity={p > 0 ? 1 : 0} />
      })}
    </svg>
  )
}

function SlideTitle({ enter }: { enter: number }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: TALLY.ink, color: "#fff" }}>
      <div className="absolute top-[42px] left-14 flex items-center gap-2.5" style={rise(enter, 0, 8)}>
        <TallyMark size={30} />
        <span className="text-[22px] font-semibold tracking-[-0.02em]">Tally</span>
      </div>
      <Label dark style={{ left: "auto", right: 56, top: 52, ...rise(enter, 0.05, 8) }}>
        FALL LAUNCH · THU OCT 22
      </Label>
      <div className="absolute top-[150px] left-14 text-[100px] leading-[0.95] font-semibold tracking-[-0.045em]">
        <div style={rise(enter, 0.08, 28)}>Forecasts,</div>
        <div style={{ ...rise(enter, 0.2, 28), color: TALLY.amber }}>by the hour.</div>
      </div>
      <div className="absolute top-[372px] left-14 text-[24px] tracking-[-0.01em] text-white/60" style={rise(enter, 0.34)}>
        Know Saturday’s rush before it starts.
      </div>
      <div className="absolute bottom-[40px] left-14 text-[14px] text-white/45" style={rise(enter, 0.44, 8)}>
        Priya Nair, Head of Product · Marcus Lee, Ops at Larkspur Coffee
      </div>
      <TallyMarks draw={c01((enter - 0.25) / 0.75)} color={TALLY.indigo} size={250} style={{ right: 56, top: 150 }} />
    </div>
  )
}

function SlideProblem({ enter }: { enter: number }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: TALLY.paper, color: TALLY.ink }}>
      <Label style={rise(enter, 0, 8)}>01 — THE PROBLEM</Label>
      <div className="absolute top-[96px] left-[50px] text-[168px] leading-none font-semibold tracking-[-0.06em] tabular-nums" style={{ ...rise(enter, 0.08, 30), color: TALLY.indigo }}>
        2 in 5
      </div>
      <div className="absolute top-[150px] left-[548px] flex gap-3">
        {[0, 1, 2, 3, 4].map((i) => {
          const short = i < 2
          const p = E.out(c01((enter - 0.2 - i * 0.07) / 0.4))
          const lit = c01((enter - 0.62 - i * 0.08) / 0.2)
          return (
            <span
              key={i}
              className="grid size-[60px] place-items-center rounded-[14px]"
              style={{ opacity: p, transform: `translateY(${(1 - p) * 14}px)`, background: short ? `rgba(245,165,36,${0.16 + 0.84 * lit})` : "rgba(22,22,31,0.06)", color: short && lit > 0.5 ? TALLY.ink : "rgba(22,22,31,0.35)" }}
            >
              <Store size={26} strokeWidth={2} />
            </span>
          )
        })}
      </div>
      <div className="absolute top-[318px] left-14 w-[800px] text-[40px] leading-[1.15] font-semibold tracking-[-0.03em]" style={rise(enter, 0.3)}>
        stores run short-staffed through the Saturday lunch rush.
      </div>
      <div className="absolute top-[440px] left-14 text-[14px] text-black/45" style={rise(enter, 0.44, 8)}>
        Tally data · 1,240 stores · Jun–Sep 2026
      </div>
      <Foot n={2} />
    </div>
  )
}

function SlideLive({ enter, chart }: { enter: number; chart: ChartState }) {
  const card = E.out(c01((enter - 0.22) / 0.6))
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: TALLY.paper, color: TALLY.ink }}>
      <Label style={rise(enter, 0, 8)}>02 — WHAT’S NEW</Label>
      <div className="absolute top-[76px] left-14 text-[46px] leading-none font-semibold tracking-[-0.035em]" style={rise(enter, 0.06, 22)}>
        See the rush before it hits.
      </div>
      <div
        className="absolute origin-top-left"
        style={{ left: SLIDE_CHART.x, top: SLIDE_CHART.y, width: CHART_W, height: CHART_H, opacity: card, transform: `translateY(${(1 - card) * 26}px) scale(${SLIDE_CHART.s * (0.97 + 0.03 * card)})` }}
      >
        <SalesChart {...chart} />
      </div>
      <Foot n={3} />
    </div>
  )
}

function SlidePlan() {
  const steps = [
    ["Forecast", "Each hour’s sales, from two years of your own tickets."],
    ["Schedule", "Shifts fill to match, inside your labor target."],
    ["Adjust", "Swap a shift in one tap when the weather turns."],
  ]
  return (
    <div className="absolute inset-0 overflow-hidden text-white" style={{ background: TALLY.indigo }}>
      <Label dark>03 — HOW IT WORKS</Label>
      <div className="absolute top-[96px] left-14 text-[64px] leading-[1.02] font-semibold tracking-[-0.04em]">
        Forecast. Schedule.
        <br />
        Adjust.
      </div>
      <div className="absolute inset-x-14 top-[330px] grid grid-cols-3 gap-8">
        {steps.map(([h, b], i) => (
          <div key={h} className="border-t border-white/30 pt-4">
            <div className="text-[13px] text-white/55" style={{ fontFamily: MONO }}>
              0{i + 1}
            </div>
            <div className="mt-1 text-[24px] font-semibold tracking-[-0.02em]">{h}</div>
            <div className="mt-1.5 text-[16px] leading-snug text-white/75">{b}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SlideClose() {
  return (
    <div className="absolute inset-0 overflow-hidden text-white" style={{ background: TALLY.ink }}>
      <TallyMarks draw={1} color={TALLY.indigo} size={150} style={{ left: 56, top: 64 }} />
      <div className="absolute top-[250px] left-14 text-[76px] leading-[1] font-semibold tracking-[-0.045em]">Live Oct 22, on every plan.</div>
      <div className="absolute top-[360px] left-14 text-[26px] tracking-[-0.01em]" style={{ color: TALLY.amber }}>
        Questions → tally.app/forecasts
      </div>
      <Foot n={5} dark />
    </div>
  )
}

/** Slide `n` (0–4) at 960×540. */
export function Slide({ n, enter = 1, chart }: { n: number; enter?: number; chart: ChartState }) {
  if (n === 0) return <SlideTitle enter={enter} />
  if (n === 1) return <SlideProblem enter={enter} />
  if (n === 2) return <SlideLive enter={enter} chart={chart} />
  if (n === 3) return <SlidePlan />
  return <SlideClose />
}

/** A slide at 960×540, scaled by `s`; `style` (a transition) applies to the shown box. */
const Scaled = ({ s, children, style }: { s: number; children: ReactNode; style?: CSSProperties }) => (
  <div className="absolute inset-0" style={style}>
    <div className="absolute top-0 left-0 origin-top-left" style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${s})` }}>
      {children}
    </div>
  </div>
)

/* ── The deck viewer ────────────────────────────────────────────────────── */

const DP = 12
const THUMB_W = 96
const THUMB_H = (THUMB_W * 9) / 16
const THUMB_GAP = 9
export const SLIDE_SHOWN_W = 640
const SS = SLIDE_SHOWN_W / SLIDE_W
const FOOT_H = 34
export const DECK_W = DP + THUMB_W + DP + SLIDE_SHOWN_W + DP
export const DECK_H = DP + SLIDE_H * SS + FOOT_H
/** Where the current slide sits in the deck, and its scale. */
export const DECK_SLIDE = { x: DP + THUMB_W + DP, y: DP, s: SS }
/** The › button, in deck px. */
export const DECK_NEXT_AT: [number, number] = [DECK_W - DP - 12, DECK_H - FOOT_H / 2]

/**
 * `thumbs` is how many thumbnails have landed and `ready` 0→1 swaps the
 * skeleton for the slides; `cur` is the slide showing, `prev` the one it came
 * from and `p` 0→1 the transition between them (a wipe into slide 2, a
 * match-cut into slide 3); `enter` plays the current slide's own animation.
 */
export function LaunchDeck({ thumbs, ready, cur, prev, p, enter, chart, press = 0 }: { thumbs: number; ready: number; cur: number; prev: number; p: number; enter: number; chart: ChartState; press?: number }) {
  const moving = p > 0 && p < 1 && prev !== cur
  const still: ChartState = { grow: 1, hover: -1, avg: 0, forecast: chart.forecast }
  let prevStyle: CSSProperties = {}
  let curStyle: CSSProperties = {}
  if (moving && cur === 1) {
    // Wipe: slide 2 pushes in from the right, title slide drifts back under it.
    const e = E.inOut(c01(p / 0.75))
    prevStyle = { transform: `translateX(${-60 * e}px) scale(${1 - 0.03 * e})`, opacity: 1 - 0.5 * e }
    curStyle = { clipPath: `inset(0 0 0 ${(1 - e) * 100}%)`, transform: `translateX(${(1 - e) * 80}px)` }
  } else if (moving) {
    // Match-cut: same paper and footer, so only the content changes. The old
    // slide fades off the top while the new one's content rises underneath.
    prevStyle = { opacity: 1 - E.inOut(c01(p / 0.4)), zIndex: 1 }
  }
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#1b1b1f] font-sans">
      {/* Thumbnail strip */}
      {[0, 1, 2, 3, 4].map((i) => {
        const on = i < thumbs
        const active = ready >= 1 && i === cur
        return (
          <div
            key={i}
            className="absolute overflow-hidden rounded-[4px] bg-white/[0.05] transition-[opacity,outline-color] duration-200"
            style={{ left: DP, top: DP + i * (THUMB_H + THUMB_GAP), width: THUMB_W, height: THUMB_H, outline: "2px solid", outlineOffset: 2, outlineColor: active ? "#ffffff" : "transparent", opacity: ready >= 1 && !active ? 0.8 : 1 }}
          >
            {on && (
              <div className="ld-thumb absolute inset-0">
                <Scaled s={THUMB_W / SLIDE_W}>
                  <Slide n={i} chart={still} />
                </Scaled>
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
          </div>
        )
      })}
      {/* The current slide */}
      <div className="absolute overflow-hidden rounded-[6px]" style={{ left: DECK_SLIDE.x, top: DECK_SLIDE.y, width: SLIDE_SHOWN_W, height: SLIDE_H * SS }}>
        <Skeleton className="bg-[#26262b]" />
        {ready > 0 && (
          <div className="absolute inset-0" style={{ opacity: ready }}>
            {moving && (
              <Scaled s={SS} style={prevStyle}>
                <Slide n={prev} chart={still} />
              </Scaled>
            )}
            <Scaled s={SS} style={curStyle}>
              <Slide n={cur} enter={enter} chart={chart} />
            </Scaled>
          </div>
        )}
      </div>
      {/* Foot: name, ‹ n / 5 › */}
      <div className="absolute inset-x-0 bottom-0 flex items-center px-3 text-[12px] text-white/45" style={{ height: FOOT_H }}>
        <span>Tally · Fall launch webinar</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className={cn("grid size-6 place-items-center rounded-[6px] bg-white/[0.06]", cur === 0 && "opacity-40")}>
            <ChevronLeft className="size-3.5 text-white/70" />
          </span>
          <span className="w-9 text-center text-white/70 tabular-nums">{cur + 1} / 5</span>
          <span className="grid size-6 place-items-center rounded-[6px] bg-white/[0.1]" style={{ transform: `scale(${1 - press * 0.14})` }}>
            <ChevronRight className="size-3.5 text-white/85" />
          </span>
        </span>
      </div>
      <style>{`@keyframes ld-thumb { from { opacity: 0; transform: scale(.92) } } .ld-thumb { animation: ld-thumb .32s cubic-bezier(.22,1,.36,1) both }`}</style>
    </div>
  )
}
