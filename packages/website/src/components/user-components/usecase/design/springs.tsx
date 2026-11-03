/**
 * "Animations other tools can't do" pieces:
 *
 *  - springAt     an analytic damped spring (mass 1): where a released card
 *                 is τ seconds later, for a stiffness and a bounce (bounce =
 *                 1 − damping ratio, the way Motion and DialKit name it)
 *  - PickStack    "Dog-ear", a made-up book-club app: tonight's picks from
 *                 Northside Readers as a swipeable card stack. Each card's
 *                 transform comes in as MotionValues so a timeline can drag,
 *                 spring and fling it. Natural size 300×600.
 *  - SpringPanel  the controls the agent adds: DialKit's Folder and Sliders,
 *                 drawn statically (landing-canvas/dialkit-replica.tsx),
 *                 with a spring curve drawn in DialKit's spring-viz style but
 *                 on a fixed scale, so more bounce reads as more overshoot,
 *                 plus the last curve as a ghost and a dot riding the curve
 *                 while a released card settles.
 */
import { type ReactNode } from "react"
import { Bookmark, BookmarkPlus, RotateCcw, Star, X } from "lucide-react"
import { motion, type MotionValue } from "motion/react"

import { DialPanel, DialSlider } from "../../landing-canvas/dialkit-replica"

/* ── The physics ───────────────────────────────────────────────────────── */

/** Displacement τ s after release from x0 moving at v0, for spring `k` (mass 1) and `bounce` (0–1). */
export function springAt(tau: number, x0: number, v0: number, k: number, bounce: number) {
  if (tau <= 0) return x0
  const w0 = Math.sqrt(k)
  const z = Math.max(0.02, 1 - bounce)
  if (z < 0.999) {
    const wd = w0 * Math.sqrt(1 - z * z)
    return Math.exp(-z * w0 * tau) * (x0 * Math.cos(wd * tau) + ((v0 + z * w0 * x0) / wd) * Math.sin(wd * tau))
  }
  if (z <= 1.001) return (x0 + (v0 + w0 * x0) * tau) * Math.exp(-w0 * tau)
  const s = Math.sqrt(z * z - 1)
  const r1 = -w0 * (z - s)
  const r2 = -w0 * (z + s)
  const c2 = (v0 - r1 * x0) / (r2 - r1)
  return (x0 - c2) * Math.exp(r1 * tau) + c2 * Math.exp(r2 * tau)
}

/* ── Dog-ear ───────────────────────────────────────────────────────────── */

export const PICK_W = 300
export const PICK_H = 600
const PAPER = "#f5f0e6"
const INK = "#1f1c17"
const SAVE = "#2f6b4a"
const SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"

/** The top card's box and the point a finger grabs it by, in frame px. */
export const CARD = { x: 20, y: 128, w: 260, h: 360 }
export const CARD_GRAB: [number, number] = [150, 236]
/** How far down each card behind sits, and how much smaller. */
const SLOT_Y = 15
const SLOT_S = 0.055

type Book = { title: string; author: string; pages: number; genre: string; rating: string; tint: string; loved: string; who: [string, string][]; cover: () => ReactNode }

const Cover = ({ bg, children }: { bg: string; children: ReactNode }) => (
  <div className="relative h-[168px] w-[112px] overflow-hidden rounded-[3px_6px_6px_3px] shadow-[0_10px_18px_-8px_rgba(31,28,23,0.55),0_2px_4px_rgba(31,28,23,0.18)]" style={{ background: bg }}>
    {children}
    {/* the spine's crease and a soft sheen */}
    <div className="absolute inset-y-0 left-[5px] w-px bg-black/20" />
    <div className="absolute inset-y-0 left-[6px] w-[3px] bg-white/15" />
    <div className="absolute inset-0 bg-gradient-to-r from-black/10 via-transparent to-white/[0.06]" />
  </div>
)

export const BOOKS: Book[] = [
  {
    title: "Piranesi",
    author: "Susanna Clarke",
    pages: 272,
    genre: "Fantasy",
    rating: "4.4",
    tint: "#dfe7e6",
    loved: "Hana, Jo and 3 others loved it",
    who: [["H", "#c9734a"], ["J", "#5d7fa6"], ["R", "#8a9a5b"]],
    cover: () => (
      <Cover bg="#1d4a55">
        <svg viewBox="0 0 112 168" className="absolute inset-0">
          {[0, 1, 2, 3].map((i) => (
            <path key={i} d={`M ${26 + i * 7} 128 V ${82 + i * 5} a ${30 - i * 7} ${30 - i * 7} 0 0 1 ${60 - i * 14} 0 V 128`} fill="none" stroke="#d9b56d" strokeOpacity={0.85 - i * 0.15} strokeWidth="1" />
          ))}
          <path d="M 18 136 q 9 -5 19 0 t 19 0 t 19 0 t 19 0 t 19 0" fill="none" stroke="#8fc0c4" strokeWidth="1.1" />
          <path d="M 18 143 q 9 -5 19 0 t 19 0 t 19 0 t 19 0 t 19 0" fill="none" stroke="#8fc0c4" strokeOpacity=".6" strokeWidth="1.1" />
        </svg>
        <div className="absolute inset-x-0 top-[18px] text-center text-[14px] tracking-[0.2em] text-[#f1e6cf]" style={{ fontFamily: SERIF }}>
          PIRANESI
        </div>
        <div className="absolute inset-x-0 top-[38px] text-center text-[6.5px] tracking-[0.24em] text-[#d9b56d]">SUSANNA CLARKE</div>
      </Cover>
    ),
  },
  {
    title: "Stoner",
    author: "John Williams",
    pages: 288,
    genre: "Literary fiction",
    rating: "4.3",
    tint: "#efe4cc",
    loved: "Priya and 6 others loved it",
    who: [["P", "#a0566b"], ["M", "#4f8a83"], ["T", "#b08a3c"]],
    cover: () => (
      <Cover bg="#d8a23f">
        <div className="absolute inset-x-[14px] top-[22px] h-px bg-[#1f1c17]/70" />
        <div className="absolute inset-x-0 top-[34px] text-center text-[25px] leading-none font-semibold tracking-[-0.01em] text-[#1f1c17]" style={{ fontFamily: SERIF }}>
          Stoner
        </div>
        <div className="absolute inset-x-0 top-[66px] text-center text-[7px] tracking-[0.18em] text-[#1f1c17]/75">JOHN WILLIAMS</div>
        <div className="absolute bottom-[22px] left-1/2 h-[46px] w-[30px] -translate-x-1/2 rounded-t-full border border-[#1f1c17]/60" />
        <div className="absolute inset-x-[14px] bottom-[16px] h-px bg-[#1f1c17]/70" />
      </Cover>
    ),
  },
  {
    title: "Tomorrow, and Tomorrow, and Tomorrow",
    author: "Gabrielle Zevin",
    pages: 416,
    genre: "Fiction",
    rating: "4.2",
    tint: "#f3dedb",
    loved: "Sam and 2 others loved it",
    who: [["S", "#6c6aa8"], ["A", "#c08552"], ["L", "#5b8f6a"]],
    cover: () => (
      <Cover bg="#f1c9c3">
        <svg viewBox="0 0 112 168" className="absolute inset-0">
          <path d="M 0 122 C 18 96 34 92 46 104 C 40 92 52 80 64 90 C 74 98 70 112 58 110 C 70 124 92 112 112 100 V 168 H 0 Z" fill="#2b4f8c" />
          <path d="M 0 140 C 24 126 44 132 60 140 S 96 146 112 134 V 168 H 0 Z" fill="#f7f1e6" fillOpacity=".9" />
        </svg>
        <div className="absolute inset-x-[10px] top-[16px] text-[11px] leading-[1.15] text-[#2b4f8c]" style={{ fontFamily: SERIF }}>
          Tomorrow,
          <br />
          and Tomorrow,
          <br />
          and Tomorrow
        </div>
        <div className="absolute top-[64px] left-[10px] text-[6px] tracking-[0.2em] text-[#2b4f8c]/80">GABRIELLE ZEVIN</div>
      </Cover>
    ),
  },
  {
    title: "Klara and the Sun",
    author: "Kazuo Ishiguro",
    pages: 320,
    genre: "Fiction",
    rating: "4.1",
    tint: "#efe6d6",
    loved: "Jo and 4 others loved it",
    who: [["J", "#5d7fa6"], ["K", "#a36a4f"], ["E", "#7d8f4e"]],
    cover: () => (
      <Cover bg="#2c3a4a">
        <div className="absolute top-[70px] left-1/2 size-[56px] -translate-x-1/2 rounded-full bg-[#f0b33c]" />
        <div className="absolute inset-x-0 top-[22px] text-center text-[12px] text-[#f4ecdc]" style={{ fontFamily: SERIF }}>
          Klara and the Sun
        </div>
      </Cover>
    ),
  },
]

/** One card's motion: offset and turn in frame px / degrees, scale, opacity, and how strong the "Want to read" stamp is. */
export type CardMotion = { x: MotionValue<number>; y: MotionValue<number>; rotate: MotionValue<number>; scale: MotionValue<number>; opacity?: MotionValue<number>; stamp?: MotionValue<number>; shadow?: MotionValue<string> }

function BookCard({ b, m, z }: { b: Book; m: CardMotion; z: number }) {
  return (
    <motion.div
      className="absolute overflow-hidden rounded-[20px] bg-white"
      style={{ left: CARD.x, top: CARD.y, width: CARD.w, height: CARD.h, zIndex: z, x: m.x, y: m.y, rotate: m.rotate, scale: m.scale, opacity: m.opacity, transformOrigin: "50% 85%", boxShadow: m.shadow ?? "0 6px 18px -8px rgba(31,28,23,0.22)" }}
    >
      <div className="grid h-[196px] place-items-center" style={{ background: b.tint }}>
        {b.cover()}
      </div>
      <div className="px-4 pt-3">
        <div className="truncate text-[21px] leading-[1.15] font-semibold tracking-[-0.01em]" style={{ fontFamily: SERIF, color: INK }}>
          {b.title}
        </div>
        <div className="mt-0.5 text-[12.5px] text-[#1f1c17]/60">{b.author}</div>
        <div className="mt-2.5 flex items-center gap-1.5 text-[10.5px] font-medium text-[#1f1c17]/70">
          <span className="rounded-full bg-[#1f1c17]/[0.06] px-2 py-[3px] tabular-nums">{b.pages} pages</span>
          <span className="rounded-full bg-[#1f1c17]/[0.06] px-2 py-[3px]">{b.genre}</span>
          <span className="flex items-center gap-0.5 rounded-full bg-[#1f1c17]/[0.06] px-2 py-[3px] tabular-nums">
            <Star size={9} fill="currentColor" strokeWidth={0} />
            {b.rating}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2 border-t border-[#1f1c17]/[0.08] pt-2.5">
          <div className="flex">
            {b.who.map(([n, c], i) => (
              <span key={i} className="-ml-1 grid size-[18px] place-items-center rounded-full text-[8.5px] font-bold text-white ring-2 ring-white first:ml-0" style={{ background: c }}>
                {n}
              </span>
            ))}
          </div>
          <span className="truncate text-[11px] text-[#1f1c17]/60">{b.loved}</span>
        </div>
      </div>
      {m.stamp && (
        <motion.div className="absolute top-[18px] left-[12px] rotate-[-12deg] rounded-[6px] border-2 px-1.5 py-px text-[11px] font-extrabold tracking-[0.06em] uppercase" style={{ opacity: m.stamp, color: SAVE, borderColor: SAVE, background: "rgba(255,255,255,0.85)" }}>
          Want to read
        </motion.div>
      )}
    </motion.div>
  )
}

/**
 * Dog-ear's picks: `cards[i]` moves BOOKS[i] (0 is on top); `saved` is the
 * Want to read count; `hot` (0–1) swells the save button as a card is
 * dragged toward it.
 */
export function PickStack({ cards, saved, hot }: { cards: CardMotion[]; saved: number; hot?: MotionValue<number> }) {
  const saveScale = hot ? undefined : 1
  return (
    <div className="absolute inset-0 overflow-hidden font-sans" style={{ background: PAPER, color: INK }}>
      <div className="flex justify-between px-5 pt-2.5 text-[11px] font-semibold">
        <span>9:41</span>
        <span>●●● ▮</span>
      </div>
      <div className="absolute inset-x-5 top-[40px] flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold tracking-[-0.01em]">
          <DogEar />
          dog-ear
        </span>
        <span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold shadow-[0_1px_3px_rgba(31,28,23,0.08)]">
          <Bookmark size={11} fill={SAVE} color={SAVE} />
          <span className="text-[#1f1c17]/60">Want to read</span>
          <span key={saved} className="dg-bump tabular-nums">
            {saved}
          </span>
        </span>
      </div>
      <div className="absolute inset-x-5 top-[70px]">
        <div className="text-[26px] leading-[1.1] font-semibold tracking-[-0.015em]" style={{ fontFamily: SERIF }}>
          Tonight's picks
        </div>
        <div className="mt-1 text-[11.5px] text-[#1f1c17]/55">From Northside Readers · swipe right to save</div>
      </div>
      {BOOKS.map((b, i) => (
        <BookCard key={b.title} b={b} m={cards[i]} z={BOOKS.length - i} />
      ))}
      <div className="absolute inset-x-0 top-[530px] flex items-center justify-center gap-5">
        <span className="grid size-[46px] place-items-center rounded-full bg-white shadow-[0_2px_8px_rgba(31,28,23,0.10)]">
          <X size={20} strokeWidth={2.2} />
        </span>
        <span className="grid size-[34px] place-items-center rounded-full bg-white text-[#1f1c17]/50 shadow-[0_2px_8px_rgba(31,28,23,0.08)]">
          <RotateCcw size={14} strokeWidth={2.2} />
        </span>
        <motion.span className="grid size-[46px] place-items-center rounded-full text-white shadow-[0_4px_12px_-2px_rgba(47,107,74,0.45)]" style={{ background: SAVE, scale: hot ?? saveScale }}>
          <BookmarkPlus size={19} strokeWidth={2.2} />
        </motion.span>
      </div>
      <div className="absolute bottom-[7px] left-1/2 h-[4px] w-[104px] -translate-x-1/2 rounded-full bg-[#1f1c17]/80" />
      <style>{`@keyframes dg-bump { 0% { transform: scale(1) } 35% { transform: scale(1.45); color: ${SAVE} } 100% { transform: scale(1) } } .dg-bump { display: inline-block; animation: dg-bump .45s cubic-bezier(.22,1,.36,1) }`}</style>
    </div>
  )
}

/** Dog-ear's mark: a page with its corner folded. */
function DogEar() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 1.5 h6.5 l3.5 3.5 v9.5 h-10 z" fill={INK} />
      <path d="M9.5 1.5 v3.5 h3.5 z" fill="#c9734a" />
    </svg>
  )
}

/** Where card i sits in the stack when the stack has advanced by `adv` (0: as dealt, 1: the top card is gone). */
export function slot(i: number, adv: number) {
  const s = i - adv
  return { y: SLOT_Y * s, scale: 1 - SLOT_S * s, opacity: s > 2 ? Math.max(0, 3 - s) : 1 }
}

/* ── The controls (DialKit) ────────────────────────────────────────────── */

export const PANEL_W = 280
const VW = 256
const VH = 140
/** The curve's time span (s) and where rest and release sit on it. */
const SPAN = 1.5
const REST_Y = 88
const UNIT = 62
const curveY = (v: number) => REST_Y - v * UNIT

function curve(k: number, bounce: number) {
  let d = ""
  for (let i = 0; i <= 120; i++) {
    const tau = (i / 120) * SPAN
    d += `${i ? "L" : "M"} ${((tau / SPAN) * VW).toFixed(1)} ${curveY(springAt(tau, 1, 0, k, bounce)).toFixed(1)} `
  }
  return d
}

/**
 * The card's spring: the response curve (a released card's offset over
 * 1.5s, release at the top, rest on the dashed line), `ghost` an earlier
 * bounce drawn faintly, `tau` the dot riding the curve (-1 off), and
 * the Stiffness / Bounce sliders (`active`: the pointer is on Bounce).
 */
export function SpringPanel({ stiffness, bounce, ghost, tau = -1, active = false, className }: { stiffness: number; bounce: number; ghost?: number; tau?: number; active?: boolean; className?: string }) {
  const dot = tau >= 0 && tau <= SPAN ? [(tau / SPAN) * VW, curveY(springAt(tau, 1, 0, stiffness, bounce))] : null
  return (
    <DialPanel title="Card spring" width={PANEL_W} className={className}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} className="dialkit-spring-viz">
          {[1, 2, 3].map((i) => (
            <g key={i}>
              <line x1={(VW / 4) * i} y1={0} x2={(VW / 4) * i} y2={VH} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
              <line x1={0} y1={(VH / 4) * i} x2={VW} y2={(VH / 4) * i} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
            </g>
          ))}
          <line x1={0} y1={REST_Y} x2={VW} y2={REST_Y} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4,4" />
          {ghost !== undefined && ghost !== bounce && <path d={curve(stiffness, ghost)} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1.5" strokeLinecap="round" />}
          <path d={curve(stiffness, bounce)} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {dot && (
            <g>
              <line x1={dot[0]} y1={0} x2={dot[0]} y2={VH} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
              <circle cx={dot[0]} cy={dot[1]} r="4" fill="#fff" />
            </g>
          )}
        </svg>
        <DialSlider label="Stiffness" value={stiffness} min={50} max={500} step={10} />
        <DialSlider label="Bounce" value={bounce} min={0} max={1} step={0.01} active={active} />
      </div>
    </DialPanel>
  )
}
