/**
 * PMDiagrams — Linear-style line diagrams for the landing page's product
 * manager list, one per item, each animating its story on a loop.
 *
 *   1.1  one idea fans out into five takes; two go on to the review
 *   1.2  "inline or its own page?" forks into both; one gets picked
 *   1.3  a screenshot is scanned, then rebuilt piece by piece
 *   1.4  a PRD's lines become linked screens; a cursor clicks through;
 *        the gaps it left are flagged
 *   1.5  a customer's request becomes a working frame, shown on a call
 *
 * Thin gray strokes draw themselves in (stroke-dashoffset over pathLength 1),
 * white strokes mark what matters, one Claude-orange dot per figure. Every
 * element runs the same 8 s cycle from its own delay, so they draw in order
 * and fade out in order. Reduced motion shows the finished drawing.
 *
 * The default export is a board of all five, large.
 */
import type { CSSProperties, ReactNode } from "react"
import interUrl from "../landing/InterVariable.woff2?url"

const BASE = "#6b6b6b"
const FAINT = "#444"
const HI = "#f2f2f2"
const ORANGE = "#d97757"

const CSS = `
.adl-d { stroke-dasharray: 1; stroke-dashoffset: 1; animation: adl-draw 8s var(--t, 0s) infinite both cubic-bezier(.45, 0, .2, 1); }
.adl-f { opacity: 0; animation: adl-fade 8s var(--t, 0s) infinite both; }
.adl-scan { opacity: 0; animation: adl-scan 8s var(--t, 0s) infinite both; }
.adl-cursor { opacity: 0; animation: adl-cursor 8s var(--t, 0s) infinite both cubic-bezier(.6, 0, .3, 1); }
.adl-knob { animation: adl-knob 8s var(--t, 0s) infinite both cubic-bezier(.6, 0, .3, 1); }
.adl-blink { opacity: 0; animation: adl-blink 8s var(--t, 0s) infinite both; }
@keyframes adl-draw { 0% { stroke-dashoffset: 1; opacity: 1; } 12% { stroke-dashoffset: 0; } 84% { stroke-dashoffset: 0; opacity: 1; } 94%, 100% { stroke-dashoffset: 0; opacity: 0; } }
@keyframes adl-fade { 0% { opacity: 0; } 8% { opacity: 1; } 84% { opacity: 1; } 94%, 100% { opacity: 0; } }
@keyframes adl-scan { 0% { opacity: 0; transform: translateY(0); } 3% { opacity: 1; } 22% { opacity: 1; transform: translateY(var(--dy)); } 27%, 100% { opacity: 0; transform: translateY(var(--dy)); } }
@keyframes adl-cursor {
  0% { opacity: 0; transform: translate(0, 6px); } 6% { opacity: 1; transform: translate(0, 0); }
  20% { transform: translate(0, 0); } 30% { transform: translate(48px, 0); }
  42% { transform: translate(48px, 0); } 52% { transform: translate(96px, 0); }
  80% { opacity: 1; transform: translate(96px, 0); } 90%, 100% { opacity: 0; transform: translate(96px, 0); }
}
@keyframes adl-knob { 0%, 14% { transform: translateX(0); } 22%, 86% { transform: translateX(11px); } 96%, 100% { transform: translateX(0); } }
@keyframes adl-blink { 0% { opacity: 0; } 6% { opacity: 1; } 12% { opacity: .35; } 18% { opacity: 1; } 84% { opacity: 1; } 94%, 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .adl-d { animation: none; stroke-dashoffset: 0; }
  .adl-f, .adl-blink, .adl-cursor { animation: none; opacity: 1; }
  .adl-cursor { transform: translate(96px, 0); }
  .adl-scan { animation: none; opacity: 0; }
  .adl-knob { animation: none; transform: translateX(11px); }
}
`

const at = (t: number, extra?: CSSProperties) => ({ "--t": `${t}s`, ...extra }) as CSSProperties

// A stroke that draws itself in at `t` seconds into the cycle.
const draw = (t: number, stroke = BASE) => ({ className: "adl-d", pathLength: 1, stroke, style: at(t) })

const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 240 150" className="block h-full w-full" fill="none" strokeWidth={0.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <style>{CSS}</style>
    {children}
  </svg>
)

// Short content lines inside a frame.
const Lines = ({ x, y, widths, t, gap = 6, stroke = FAINT }: { x: number; y: number; widths: number[]; t: number; gap?: number; stroke?: string }) => (
  <>
    {widths.map((w, i) => (
      <line key={i} x1={x} y1={y + i * gap} x2={x + w} y2={y + i * gap} {...draw(t + i * 0.08, stroke)} />
    ))}
  </>
)

const Dot = ({ cx, cy, t }: { cx: number; cy: number; t: number }) => <circle cx={cx} cy={cy} r={2.2} fill={ORANGE} className="adl-f" style={at(t)} />

/* ── 1.1  Five takes, not one idea ────────────────────────────────────── */

const TAKES = [21, 48, 75, 102, 129]
const KEPT = [1, 3]

export const FigFiveTakes = () => (
  <Svg>
    {/* The idea */}
    <rect x={14} y={63} width={34} height={24} rx={3} {...draw(0)} />
    <Lines x={20} y={71} widths={[16, 10]} t={0.2} gap={7} />
    {/* Fanning out */}
    {TAKES.map((y, i) => (
      <path key={y} d={`M48 75 C 70 75, 72 ${y}, 94 ${y}`} {...draw(0.45 + i * 0.12)} />
    ))}
    {TAKES.map((y, i) => (
      <g key={y}>
        <rect x={94} y={y - 10} width={56} height={20} rx={3} {...draw(0.7 + i * 0.12)} />
        <Lines x={100} y={y - 3} widths={[22 + ((i * 7) % 14), 14 + ((i * 5) % 12)]} t={0.9 + i * 0.12} />
      </g>
    ))}
    {/* The two that go to the review */}
    {KEPT.map((i, k) => (
      <g key={i}>
        <rect x={94} y={TAKES[i] - 10} width={56} height={20} rx={3} {...draw(2.1 + k * 0.2, HI)} />
        <path d={`M150 ${TAKES[i]} C 166 ${TAKES[i]}, 166 75, 182 75`} {...draw(2.5 + k * 0.15, HI)} />
      </g>
    ))}
    {/* The review */}
    <rect x={182} y={52} width={44} height={46} rx={3} {...draw(2.8, HI)} />
    <rect x={188} y={59} width={14} height={14} rx={2} {...draw(3.0)} />
    <rect x={206} y={59} width={14} height={14} rx={2} {...draw(3.1)} />
    <Lines x={188} y={82} widths={[30, 20]} t={3.2} />
    <Dot cx={226} cy={52} t={3.4} />
  </Svg>
)

/* ── 1.2  Build both ──────────────────────────────────────────────────── */

export const FigBuildBoth = () => (
  <Svg>
    {/* The question */}
    <circle cx={120} cy={20} r={9} {...draw(0)} />
    <text x={120} y={23.5} textAnchor="middle" fontSize={10} fill={BASE} className="adl-f" style={at(0.3)}>
      ?
    </text>
    <path d="M120 29 V40 M120 40 H64 V54 M120 40 H176 V54" {...draw(0.5)} />
    {/* Inline: a panel inside the page */}
    <rect x={24} y={54} width={80} height={78} rx={3} {...draw(0.9)} />
    <Lines x={31} y={64} widths={[22, 18, 24, 14]} t={1.2} gap={9} />
    <rect x={60} y={60} width={38} height={66} rx={2} {...draw(1.4)} />
    <Lines x={65} y={68} widths={[20, 26, 16]} t={1.6} gap={8} />
    <rect x={65} y={112} width={26} height={8} rx={2} {...draw(1.8)} />
    {/* Its own page */}
    <rect x={136} y={54} width={80} height={78} rx={3} {...draw(1.0)} />
    <rect x={143} y={61} width={66} height={22} rx={2} {...draw(1.3)} />
    <Lines x={143} y={92} widths={[54, 40, 60, 30]} t={1.5} gap={8} />
    <rect x={143} y={118} width={30} height={8} rx={2} {...draw(1.9)} />
    {/* Picked */}
    <rect x={20} y={50} width={88} height={86} rx={5} {...draw(2.6, HI)} />
    <path d="M100 46 l3 3 l6 -6" {...draw(3.0, HI)} strokeWidth={0.9} />
    <Dot cx={120} cy={40} t={2.4} />
  </Svg>
)

/* ── 1.3  From a screenshot ───────────────────────────────────────────── */

// Where the pieces sit, in both frames.
const PIECES = [
  { y: 8, h: 8, w: 76 },
  { y: 22, h: 34, w: 76 },
  { y: 62, h: 5, w: 52 },
  { y: 71, h: 5, w: 40 },
  { y: 80, h: 10, w: 30 },
]

export const FigScreenshot = () => (
  <Svg>
    {/* The screenshot: dashed edge, pieces as flat fills */}
    <rect x={16} y={26} width={88} height={98} rx={3} stroke={BASE} strokeDasharray="3 3" className="adl-f" style={at(0)} />
    {PIECES.map((p, i) => (
      <rect key={i} x={22} y={26 + p.y} width={p.w} height={p.h} rx={1.5} fill="#ffffff" fillOpacity={0.07} className="adl-f" style={at(0.1 + i * 0.05)} />
    ))}
    <line x1={16} y1={26} x2={104} y2={26} stroke={HI} strokeOpacity={0.8} className="adl-scan" style={at(0.4, { "--dy": "98px" } as CSSProperties)} />
    {/* Matching each piece across */}
    {PIECES.map((p, i) => (
      <path key={i} d={`M${22 + p.w} ${26 + p.y + p.h / 2} H136`} stroke={FAINT} strokeDasharray="1 3" className="adl-f" style={at(1.3 + i * 0.12)} />
    ))}
    {/* The rebuild, with real parts */}
    <rect x={136} y={26} width={88} height={98} rx={3} {...draw(1.2)} />
    {PIECES.map((p, i) => (
      <rect key={i} x={142} y={26 + p.y} width={p.w} height={p.h} rx={1.5} {...draw(1.5 + i * 0.15, i === 4 ? HI : BASE)} />
    ))}
    <rect x={136} y={26} width={88} height={98} rx={3} {...draw(2.7, HI)} />
    <Dot cx={224} cy={26} t={2.9} />
  </Svg>
)

/* ── 1.4  A PRD you can click ─────────────────────────────────────────── */

const DOC = [34, 26, 38, 22, 32, 28, 36]
const SCREENS = [92, 140, 188]

export const FigPrdFlow = () => (
  <Svg>
    {/* The PRD */}
    <rect x={12} y={20} width={56} height={110} rx={3} {...draw(0)} />
    <line x1={19} y1={30} x2={44} y2={30} {...draw(0.15, HI)} />
    <Lines x={19} y={44} widths={DOC} t={0.3} gap={11} />
    {/* The gaps it left */}
    {[2, 5].map((i, k) => (
      <g key={i} className="adl-blink" style={at(2.9 + k * 0.2)}>
        <circle cx={60} cy={44 + i * 11} r={4} stroke={ORANGE} strokeDasharray="1.5 1.5" />
      </g>
    ))}
    <path d="M68 75 H86" {...draw(0.9)} />
    <path d="M83 72 l3 3 l-3 3" {...draw(1.0)} />
    {/* The flow */}
    {SCREENS.map((x, i) => (
      <g key={x}>
        <rect x={x} y={46} width={40} height={58} rx={3} {...draw(1.1 + i * 0.2)} />
        <Lines x={x + 6} y={56} widths={[18, 26, 14]} t={1.3 + i * 0.2} gap={7} />
        <rect x={x + 6} y={88} width={20} height={8} rx={2} {...draw(1.5 + i * 0.2, i === 2 ? HI : BASE)} />
      </g>
    ))}
    {[0, 1].map((i) => (
      <path key={i} d={`M${SCREENS[i] + 26} 92 C ${SCREENS[i] + 38} 92, ${SCREENS[i + 1] - 6} 116, ${SCREENS[i + 1] + 16} 104`} {...draw(1.6 + i * 0.2, FAINT)} />
    ))}
    {/* Clicking through */}
    <g className="adl-cursor" style={at(2.0)}>
      <path d="M108 90 l0 11 l3 -3 l2.5 5 l2 -1 l-2.5 -5 l4 0 z" stroke={HI} fill="#262626" />
    </g>
  </Svg>
)

/* ── 1.5  Their request, working, on the call ─────────────────────────── */

export const FigCustomerCall = () => (
  <Svg>
    {/* What they asked for */}
    <path d="M14 22 h62 a4 4 0 0 1 4 4 v24 a4 4 0 0 1 -4 4 h-46 l-8 7 v-7 h-8 a4 4 0 0 1 -4 -4 v-24 a4 4 0 0 1 4 -4 z" {...draw(0)} />
    <Lines x={20} y={32} widths={[44, 30]} t={0.3} gap={8} />
    <path d="M58 68 C 70 86, 80 86, 92 86" {...draw(0.7)} />
    {/* Working */}
    <rect x={92} y={50} width={58} height={74} rx={3} {...draw(0.9)} />
    <Lines x={99} y={60} widths={[26, 38]} t={1.1} gap={7} />
    <rect x={99} y={80} width={24} height={13} rx={6.5} {...draw(1.3)} />
    <g className="adl-knob" style={at(1.4)}>
      <circle cx={105.5} cy={86.5} r={4.2} {...draw(1.4, HI)} />
    </g>
    <rect x={99} y={104} width={30} height={10} rx={2} {...draw(1.6, HI)} />
    <path d="M150 86 H168" {...draw(2.0)} />
    {/* The call: the frame, shared, with them watching */}
    <rect x={168} y={30} width={60} height={96} rx={4} {...draw(2.2)} />
    <rect x={174} y={38} width={48} height={52} rx={2} {...draw(2.4, HI)} />
    <Lines x={180} y={48} widths={[22, 30]} t={2.6} gap={7} />
    <rect x={180} y={70} width={16} height={8} rx={4} {...draw(2.7)} />
    {[187, 211].map((cx, i) => (
      <g key={cx}>
        <circle cx={cx} cy={104} r={6} {...draw(2.8 + i * 0.15)} />
        <path d={`M${cx - 9} 120 a9 7 0 0 1 18 0`} {...draw(2.9 + i * 0.15)} />
      </g>
    ))}
    {/* Seen */}
    <circle cx={76} cy={22} r={6} {...draw(3.3, HI)} />
    <path d="M73.2 22 l2 2 l3.8 -4" {...draw(3.5, HI)} />
    <Dot cx={228} cy={30} t={3.1} />
  </Svg>
)

export const PM_FIGS = [FigFiveTakes, FigBuildBoth, FigScreenshot, FigPrdFlow, FigCustomerCall]

/* ── Board ────────────────────────────────────────────────────────────── */

const CAPTIONS = [
  "Bring five takes to the review, not one idea.",
  "Settle “inline or its own page?” by building both.",
  "Start from a screenshot of the real page, so it looks like your product.",
  "Turn a PRD into a flow you can click, with the gaps it left listed.",
  "Show a customer their request working, on the next call.",
]

export default function PMDiagrams() {
  return (
    <div className="min-h-screen bg-[#262626] p-10 text-[#f2f2f2] antialiased" style={{ fontFamily: '"Inter Variable", -apple-system, sans-serif' }}>
      <style>{`@font-face { font-family: "Inter Variable"; src: url("${interUrl}") format("woff2"); font-weight: 100 900; font-display: swap; }`}</style>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-6">
        {PM_FIGS.map((Fig, i) => (
          <figure key={i}>
            <div className="relative aspect-[240/150] rounded-[12px] border border-white/[0.08] bg-[#222]">
              <span className="absolute top-3 left-3.5 font-mono text-[10px] tracking-[0.08em] text-[#6b6b6b]">FIG 1.{i + 1}</span>
              <Fig />
            </div>
            <figcaption className="mt-3 text-[13.5px] text-[#9a9a9a]">{CAPTIONS[i]}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  )
}
