/**
 * "Every size, from one design" pieces, in the Lull brand (campaign.tsx's
 * made-up speaker, Lull 2):
 *
 *  - LullSpeaker  the product shot: a cup-sized fabric speaker with a light
 *                 ring on top, drawn in SVG so it stays sharp at any size
 *  - LaunchAd     the launch ad. It takes a layout (`Lay`) and lays itself
 *                 out in whatever box it's given: logo, eyebrow, headline,
 *                 price line, CTA and the speaker on its disc and rings
 *  - LAYS         one layout per format (feed 4:5, square, story, the
 *                 728×90 leaderboard); `mixLay` blends two, so a frame can
 *                 morph from the feed design into its own size while the
 *                 headline really rewraps at each width
 *
 * Layout positions are fractions of the box; sizes are px at stage scale.
 */
import { useId } from "react"
import { motion, type MotionValue } from "motion/react"
import { ArrowRight } from "lucide-react"

import { mix } from "../../motion/canvas-ai/kit"

/* ── Brand ──────────────────────────────────────────────────────────────── */

const PAPER = "#EFE7DA"
const DISC = "#E3D5BF"
const INK = "#1F1B16"
const CLAY = "#B5562F"

export const HEADLINES = ["Big sound. Small shelf.", "The size of a cup. The sound of a room."] as const

/** Lull 2: a fabric cylinder, dark cap, a light ring on top. `h` is px; it's 0.74 as wide. */
export function LullSpeaker({ h }: { h: number }) {
  const id = useId().replace(/:/g, "")
  return (
    <svg width={(h * 80) / 108} height={h} viewBox="0 0 80 108" aria-hidden="true" className="block overflow-visible">
      <defs>
        <linearGradient id={`${id}b`} x1="0" x2="1">
          <stop offset="0" stopColor="#8E4325" />
          <stop offset="0.3" stopColor="#D5845F" />
          <stop offset="0.56" stopColor="#C46A45" />
          <stop offset="1" stopColor="#7E3a1F" />
        </linearGradient>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4B3D35" />
          <stop offset="1" stopColor="#2A221D" />
        </linearGradient>
        <pattern id={`${id}k`} width="2.6" height="2.6" patternUnits="userSpaceOnUse">
          <circle cx="1.3" cy="1.3" r="0.55" fill="rgba(40,16,4,0.2)" />
        </pattern>
      </defs>
      <ellipse cx="40" cy="103" rx="38" ry="4" fill="rgba(60,35,18,0.22)" />
      <path d="M6 16 V90 Q6 102 18 102 H62 Q74 102 74 90 V16 Z" fill={`url(#${id}b)`} />
      <path d="M6 16 V90 Q6 102 18 102 H62 Q74 102 74 90 V16 Z" fill={`url(#${id}k)`} />
      <ellipse cx="40" cy="16" rx="34" ry="9" fill={`url(#${id}t)`} />
      <ellipse cx="40" cy="16.4" rx="33.6" ry="8.7" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="0.8" />
      <ellipse cx="40" cy="16" rx="15" ry="3.8" fill="none" stroke="#F6E6D2" strokeOpacity="0.9" strokeWidth="1.3" />
      <rect x="35" y="84" width="10" height="5" rx="1.4" fill="#2A221D" fillOpacity="0.8" />
    </svg>
  )
}

/* ── Layouts ────────────────────────────────────────────────────────────── */

/**
 * logo [x, y, size, ax] · eye [x, y, size, ax, opacity] ·
 * head [left, y, width, size, ay, align] · meta [x, y, size, ax, opacity] ·
 * cta [x, y, size, ax] · prod [cx, cy, height px].
 * `ax` anchors x (0 left, .5 centre, 1 right), `ay` anchors the headline's
 * y (0 top, .5 middle, 1 bottom); `align` .5 centres its lines.
 */
export type Lay = Record<"logo" | "eye" | "head" | "meta" | "cta" | "prod", readonly number[]>

export type Format = "feed" | "square" | "story" | "banner"

export const LAYS: Record<Format, Lay> = {
  feed: {
    logo: [0.085, 0.08, 16, 0],
    eye: [0.085, 0.155, 7.5, 0, 1],
    head: [0.085, 0.79, 0.83, 21, 1, 0],
    meta: [0.915, 0.895, 8.5, 1, 1],
    cta: [0.085, 0.895, 10, 0],
    prod: [0.6, 0.38, 112],
  },
  square: {
    logo: [0.08, 0.085, 16, 0],
    eye: [0.08, 0.16, 7.5, 0, 1],
    head: [0.08, 0.5, 0.47, 23, 0.5, 0],
    meta: [0.08, 0.92, 8.5, 0, 1],
    cta: [0.08, 0.8, 10.5, 0],
    prod: [0.735, 0.55, 138],
  },
  story: {
    logo: [0.5, 0.065, 16, 0.5],
    eye: [0.5, 0.125, 7.5, 0.5, 1],
    head: [0.08, 0.16, 0.84, 23, 0, 0.5],
    meta: [0.5, 0.945, 8.5, 0.5, 1],
    cta: [0.5, 0.88, 11, 0.5],
    prod: [0.5, 0.6, 150],
  },
  banner: {
    logo: [0.028, 0.5, 17, 0],
    eye: [0.028, 0.5, 7.5, 0, 0],
    head: [0.27, 0.5, 0.49, 15, 0.5, 0],
    meta: [0.8, 0.5, 8.5, 1, 0],
    cta: [0.972, 0.5, 10, 1],
    prod: [0.175, 0.57, 58],
  },
}

/** Blend two layouts (every number eases from a to b). */
export function mixLay(a: Lay, b: Lay, p: number): Lay {
  const out = {} as Record<keyof Lay, number[]>
  for (const k of Object.keys(a) as (keyof Lay)[]) out[k] = a[k].map((v, i) => mix(v, b[k][i], p))
  return out
}

/* ── The ad ─────────────────────────────────────────────────────────────── */

/**
 * The launch ad, laid out by `lay` in a `w`×`h` box. `headOpacity` dips the
 * headline while its copy changes; `flash` 0→1→0 rings it as it lands.
 */
export function LaunchAd({ lay, w, h, headline = HEADLINES[0], headOpacity, flash = 0 }: { lay: Lay; w: number; h: number; headline?: string; headOpacity?: MotionValue<number>; flash?: number }) {
  const [lx, ly, ls, lax] = lay.logo
  const [ex, ey, es, eax, eop] = lay.eye
  const [hx, hy, hw, hs, hay, hal] = lay.head
  const [mx, my, ms, max, mop] = lay.meta
  const [cx, cy, cs, cax] = lay.cta
  const [px, py, ph] = lay.prod
  const at = (x: number, y: number, ax: number, ay = 0.5) => ({ left: x * w, top: y * h, transform: `translate(${-ax * 100}%, ${-ay * 100}%)` })
  return (
    <div className="relative overflow-hidden font-sans" style={{ width: w, height: h, background: PAPER, color: INK }}>
      {/* the disc and rings sit behind the product */}
      {[2.3, 1.75].map((r) => (
        <span key={r} className="absolute rounded-full" style={{ ...at(px, py, 0.5), width: ph * r, height: ph * r, boxShadow: `inset 0 0 0 1px rgba(31,27,22,0.08)` }} />
      ))}
      <span className="absolute rounded-full" style={{ ...at(px, py, 0.5), width: ph * 1.22, height: ph * 1.22, background: DISC }} />
      <span className="absolute" style={{ ...at(px, py + (ph * 0.06) / h, 0.5) }}>
        <LullSpeaker h={ph} />
      </span>

      <span className="absolute leading-none font-semibold tracking-[-0.045em] whitespace-nowrap" style={{ ...at(lx, ly, lax), fontSize: ls }}>
        lull
      </span>
      <span className="absolute leading-none font-semibold tracking-[0.16em] whitespace-nowrap uppercase" style={{ ...at(ex, ey, eax), fontSize: es, color: CLAY, opacity: eop }}>
        Introducing Lull 2
      </span>

      <div className="absolute" style={{ left: hx * w, top: hy * h, width: hw * w, transform: `translateY(${-hay * 100}%)` }}>
        <motion.div className="leading-[1.04] font-semibold tracking-[-0.035em] text-balance" style={{ fontSize: hs, textAlign: hal >= 0.25 ? "center" : "left", opacity: headOpacity }}>
          {headline}
        </motion.div>
        <div className="pointer-events-none absolute -inset-x-1.5 -inset-y-1 rounded-[5px]" style={{ boxShadow: "0 0 0 1.5px #3b82f6, 0 0 0 5px rgba(59,130,246,0.16)", opacity: flash }} />
      </div>

      <span className="absolute leading-none font-medium whitespace-nowrap tabular-nums" style={{ ...at(mx, my, max), fontSize: ms, color: "rgba(31,27,22,0.55)", opacity: mop }}>
        $249 · Ships May 12
      </span>
      <span
        className="absolute inline-flex items-center rounded-full leading-none font-semibold whitespace-nowrap"
        style={{ ...at(cx, cy, cax), fontSize: cs, gap: cs * 0.4, padding: `${cs * 0.62}px ${cs * 1.1}px`, background: INK, color: PAPER }}
      >
        Preorder <ArrowRight style={{ width: cs, height: cs }} strokeWidth={2.4} />
      </span>
    </div>
  )
}
