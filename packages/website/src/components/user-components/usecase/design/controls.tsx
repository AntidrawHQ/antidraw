/**
 * "Build the controls you need" pieces, for UseCaseDesignControls:
 *
 *  - ProductCard   Halden Roasters' product card (a made-up specialty roaster):
 *                  a bag of Kochere on a stone plate, origin, notes, size,
 *                  price and Add to bag. Takes the four things the designer
 *                  asked handles for: corner radius `r`, `accent`, `density`
 *                  (0 compact → 1 cozy → 2 airy, continuous so spacing
 *                  reflows) and the Fresh lot `badge`.
 *  - CardControls  the bespoke panel the agent docks beside it: a Corners
 *                  slider with a live corner glyph and px readout, the four
 *                  accents from halden-tokens.ts, a Density segmented control
 *                  with spacing glyphs, and the badge toggle with its chip.
 *
 * Both are laid out on fixed numbers so a scene can aim at them: CARD_W,
 * PANEL_W × PANEL_H, and PANEL_HIT's points in panel px.
 */
import type { CSSProperties, ReactNode } from "react"

import { cn } from "@/lib/utils"

const mix = (a: number, b: number, p: number) => a + (b - a) * p
/** Piecewise across compact / cozy / airy for a density 0→2. */
const dens = (d: number, [a, b, c]: readonly [number, number, number]) => (d <= 1 ? mix(a, b, d) : mix(b, c, d - 1))

const EASE = "cubic-bezier(.65,0,.35,1)"
const tint: CSSProperties = { transition: `background-color .45s ${EASE}, color .45s ${EASE}, fill .45s ${EASE}, box-shadow .45s ${EASE}` }
const SERIF = "font-['Fraunces',Georgia,'Times_New_Roman',serif]"
const MONO = "font-['Geist_Mono',ui-monospace,SFMono-Regular,Menlo,monospace] tabular-nums"

/* ── The brand ──────────────────────────────────────────────────────────── */

/** halden-tokens.ts: the roaster's four accents. */
export const ACCENTS = [
  { name: "Ink", hex: "#22304F" },
  { name: "Moss", hex: "#56703F" },
  { name: "Ember", hex: "#C2502A" },
  { name: "Rye", hex: "#8A5A33" },
] as const
const PAPER = "#FFFDF8"
const INK = "#1F1C18"
const STONE = "#ECE3D5"
const KRAFT = "#C9A47B"

export const DENSITIES = ["Compact", "Cozy", "Airy"] as const

/* ── ProductCard ────────────────────────────────────────────────────────── */

export const CARD_W = 300

function Bag({ accent }: { accent: string }) {
  return (
    <svg width="132" height="150" viewBox="0 0 132 150" aria-hidden="true">
      <ellipse cx="66" cy="141" rx="50" ry="5" fill="rgba(60,40,20,0.13)" />
      {/* the bag: kraft body, crimped top */}
      <path d="M26 30 L106 30 L111 138 Q111 141 108 141 L24 141 Q21 141 21 138 Z" fill={KRAFT} />
      <path d="M26 30 L40 30 L37 141 L24 141 Q21 141 21 138 Z" fill="rgba(255,255,255,0.10)" />
      <path d="M92 30 L106 30 L111 138 Q111 141 108 141 L96 141 Z" fill="rgba(70,40,15,0.10)" />
      <rect x="23" y="12" width="86" height="20" rx="2" fill="#B88F63" />
      <path d="M23 18 H109" stroke="rgba(60,35,10,0.25)" strokeWidth="1" strokeDasharray="2 2" />
      <circle cx="66" cy="44" r="3.2" fill="rgba(60,35,10,0.28)" />
      {/* the label, in the accent */}
      <rect x="36" y="60" width="60" height="62" rx="2" style={{ ...tint, fill: accent }} />
      <circle cx="66" cy="76" r="6.5" fill="none" stroke={PAPER} strokeWidth="1.4" />
      <path d="M62.2 77.5 q 3.8 -4.6 7.6 0" fill="none" stroke={PAPER} strokeWidth="1.4" strokeLinecap="round" />
      <text x="66" y="96" textAnchor="middle" fontSize="8.5" fontWeight="700" letterSpacing="2.2" fill={PAPER} fontFamily="ui-sans-serif, system-ui">
        HALDEN
      </text>
      <text x="66" y="108" textAnchor="middle" fontSize="5.6" letterSpacing="1.2" fill={PAPER} opacity="0.8" fontFamily="ui-sans-serif, system-ui">
        KOCHERE · LOT 74
      </text>
    </svg>
  )
}

function Bean({ x, y, rot }: { x: number; y: number; rot: number }) {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" className="absolute" style={{ left: x, top: y, transform: `rotate(${rot}deg)` }} aria-hidden="true">
      <ellipse cx="8" cy="6" rx="7.4" ry="5.2" fill="#5A3A22" />
      <path d="M2.5 6.5 Q 8 3 13.5 5.8" fill="none" stroke="#2E1C10" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  )
}

/**
 * `r` is the corner radius in px (the plate, chips and button follow it),
 * `accent` a hex from ACCENTS, `density` 0→2 (padding, gaps and the plate
 * height reflow), `badge` shows the Fresh lot pill on the plate.
 */
export function ProductCard({ r, accent, density, badge }: { r: number; accent: string; density: number; badge: boolean }) {
  const pad = dens(density, [12, 16, 22])
  const gap = dens(density, [10, 13, 17])
  const plateH = dens(density, [164, 178, 194])
  const inner = Math.max(2, r * 0.6)
  return (
    <div className="flex flex-col font-sans" style={{ width: CARD_W, padding: pad, borderRadius: r, background: PAPER, color: INK, gap, boxShadow: "0 12px 32px -14px rgba(0,0,0,0.35)" }}>
      <div className="relative overflow-hidden" style={{ height: plateH, borderRadius: inner, background: STONE }}>
        <div className="absolute inset-0 grid place-items-center pt-1">
          <Bag accent={accent} />
        </div>
        <Bean x={198} y={plateH - 34} rot={-20} />
        <Bean x={216} y={plateH - 26} rot={14} />
        <Bean x={40} y={plateH - 28} rot={32} />
        <span
          className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2 py-[3px] text-[10.5px] font-semibold tracking-[0.01em] text-white"
          style={{ ...tint, background: accent, borderRadius: Math.max(3, r * 0.5), opacity: badge ? 1 : 0, transform: badge ? "none" : "translateY(-4px) scale(.9)", transition: `${tint.transition}, opacity .3s ${EASE}, transform .4s cubic-bezier(.22,1.4,.36,1)` }}
        >
          <span className="size-[5px] rounded-full bg-white/85" />
          Fresh lot · roasted Tue
        </span>
        <span className="absolute top-2.5 right-2.5 rounded-full bg-white/70 px-1.5 py-[2px] text-[10px] font-medium text-black/55">Filter roast</span>
      </div>
      <div>
        <div className="text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ ...tint, color: accent }}>
          Ethiopia · Washed
        </div>
        <div className={cn("mt-1 text-[21px] leading-[1.15] font-medium tracking-[-0.01em]", SERIF)}>Kochere, Yirgacheffe</div>
        <div className="mt-1 text-[12.5px] leading-snug text-black/55">Bergamot, white peach, black tea</div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="px-2.5 py-[5px] text-[11.5px] font-semibold" style={{ borderRadius: inner, boxShadow: `inset 0 0 0 1.5px ${INK}` }}>
          250 g
        </span>
        <span className="px-2.5 py-[5px] text-[11.5px] font-medium text-black/50" style={{ borderRadius: inner, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.14)" }}>
          1 kg
        </span>
        <span className="ml-auto text-[17px] font-semibold tabular-nums">$22</span>
      </div>
      <div>
        <div className="grid h-10 place-items-center text-[13px] font-semibold text-white" style={{ ...tint, background: accent, borderRadius: inner }}>
          Add to bag
        </div>
        <div className="mt-2 text-center text-[10.5px] text-black/45">Roasted to order · ships the next day</div>
      </div>
      <style>{`@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500&display=swap");`}</style>
    </div>
  )
}

/* ── CardControls ───────────────────────────────────────────────────────── */

export const PANEL_W = 256
const PX = 16
const HEAD = 40
const ROW = { corners: HEAD, accent: HEAD + 76, density: HEAD + 76 * 2, badge: HEAD + 76 * 3 }
export const PANEL_H = ROW.badge + 54
export const R_MAX = 24
const TRACK = { x: PX, w: PANEL_W - 2 * PX, y: ROW.corners + 44 }
const SW = { size: 28, step: 38, y: ROW.accent + 47 }
const SEG = { x: PX, w: PANEL_W - 2 * PX, y: ROW.density + 33, h: 30 }
const TOGGLE = { w: 32, h: 18 }

/** Where to aim, in panel px: the radius knob at a value, a swatch, a density segment, the badge toggle. */
export const PANEL_HIT = {
  knob: (r: number): [number, number] => [TRACK.x + (r / R_MAX) * TRACK.w, TRACK.y],
  swatch: (i: number): [number, number] => [PX + SW.size / 2 + i * SW.step, SW.y],
  seg: (i: number): [number, number] => [SEG.x + (SEG.w / 3) * (i + 0.5), SEG.y + SEG.h / 2],
  toggle: [PANEL_W - PX - TOGGLE.w / 2, ROW.badge + 26] as [number, number],
}

function Label({ children, value, live }: { children: ReactNode; value: ReactNode; live?: boolean }) {
  return (
    <div className="flex h-4 items-center justify-between">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-white/80">{children}</span>
      <span className={cn("rounded-[4px] px-1.5 py-px text-[10.5px] transition-colors duration-200", MONO, live ? "bg-white/[0.12] text-white" : "text-white/45")}>{value}</span>
    </div>
  )
}

/** A corner whose rounding follows the slider. */
function CornerGlyph({ r }: { r: number }) {
  const k = 1 + (r / R_MAX) * 8
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d={`M1.5 11 V${1.5 + k} Q1.5 1.5 ${1.5 + k} 1.5 H11`} stroke="currentColor" strokeOpacity=".6" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/** Three bars, spaced like the density they stand for. */
function DensityGlyph({ i }: { i: number }) {
  const s = [2.4, 3.4, 4.4][i]
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      {[-1, 0, 1].map((k) => (
        <rect key={k} x="1.5" y={6 + k * s - 0.5} width="9" height="1" rx=".5" fill="currentColor" />
      ))}
    </svg>
  )
}

/**
 * `r` drives the Corners slider (`grab` lifts its knob and lights the
 * readout), `accent` is the chosen ACCENTS index, `density` the segment
 * (0–2), `badge` the toggle. `reveal` 0→1 per row brings the controls in as
 * they're built.
 */
export function CardControls({ r, accent, density, badge, grab = false, reveal = [1, 1, 1, 1] }: { r: number; accent: number; density: number; badge: boolean; grab?: boolean; reveal?: readonly number[] }) {
  const a = ACCENTS[accent]
  const knobX = (r / R_MAX) * TRACK.w
  const row = (i: number): CSSProperties => ({ opacity: reveal[i], transform: `translateY(${(1 - reveal[i]) * 6}px)` })
  return (
    <div className="relative overflow-hidden rounded-[12px] bg-[#1C1C1C] font-sans text-white ring-1 ring-white/[0.09]" style={{ width: PANEL_W, height: PANEL_H, boxShadow: "0 10px 28px -12px rgba(0,0,0,0.32)" }}>
      <div className="flex items-center justify-between border-b border-white/[0.07]" style={{ height: HEAD, padding: `0 ${PX}px` }}>
        <span className="text-[12px] font-semibold text-white/90">Card controls</span>
        <span className={cn("text-[10.5px] text-white/35", MONO)}>ProductCard</span>
      </div>

      {/* Corners */}
      <div className="absolute inset-x-0" style={{ top: ROW.corners, padding: `14px ${PX}px 0`, ...row(0) }}>
        <Label value={`${Math.round(r)}px`} live={grab}>
          <CornerGlyph r={r} />
          Corners
        </Label>
      </div>
      <div className="absolute" style={{ left: TRACK.x, top: TRACK.y - 2, width: TRACK.w, height: 4, ...row(0) }}>
        <div className="absolute inset-0 rounded-full bg-white/[0.10]" />
        <div className="absolute inset-y-0 left-0 rounded-full bg-white/75" style={{ width: knobX }} />
        <span
          className="absolute top-1/2 size-[14px] rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-transform duration-150"
          style={{ left: knobX, transform: `translate(-50%, -50%) scale(${grab ? 1.18 : 1})` }}
        />
        {[0, 4, 8, 12, 16, 20, 24].map((v) => (
          <span key={v} className="absolute top-[12px] h-[4px] w-px bg-white/20" style={{ left: (v / R_MAX) * TRACK.w }} />
        ))}
        {[0, 8, 16, 24].map((v) => (
          <span key={v} className={cn("absolute top-[19px] -translate-x-1/2 text-[9.5px] text-white/30", MONO)} style={{ left: (v / R_MAX) * TRACK.w }}>
            {v}
          </span>
        ))}
      </div>
      <Divider y={ROW.accent} opacity={reveal[1]} />

      {/* Accent */}
      <div className="absolute inset-x-0" style={{ top: ROW.accent, padding: `14px ${PX}px 0`, ...row(1) }}>
        <Label value={<>{a.name} <span className="text-white/30">{a.hex}</span></>}>Accent</Label>
      </div>
      <div className="absolute flex" style={{ left: PX, top: SW.y - SW.size / 2, gap: SW.step - SW.size, ...row(1) }}>
        {ACCENTS.map((s, i) => (
          <span
            key={s.name}
            className="rounded-full transition-shadow duration-200"
            style={{ width: SW.size, height: SW.size, background: s.hex, boxShadow: i === accent ? "0 0 0 2px #1C1C1C, 0 0 0 3.5px rgba(255,255,255,0.9)" : "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
          />
        ))}
      </div>
      <Divider y={ROW.density} opacity={reveal[2]} />

      {/* Density */}
      <div className="absolute inset-x-0" style={{ top: ROW.density, padding: `14px ${PX}px 0`, ...row(2) }}>
        <Label value={`pad ${[12, 16, 22][density]} · gap ${[10, 13, 17][density]}`}>Density</Label>
      </div>
      <div className="absolute rounded-[8px] bg-white/[0.06]" style={{ left: SEG.x, top: SEG.y, width: SEG.w, height: SEG.h, ...row(2) }}>
        <span
          className="absolute top-[2px] bottom-[2px] rounded-[6px] bg-white/[0.14] shadow-[0_1px_2px_rgba(0,0,0,0.3)] transition-[left] duration-[420ms] ease-[cubic-bezier(.65,0,.35,1)]"
          style={{ left: 2 + (SEG.w / 3) * density, width: SEG.w / 3 - 4 }}
        />
        <div className="relative flex h-full">
          {DENSITIES.map((d, i) => (
            <span key={d} className={cn("flex flex-1 items-center justify-center gap-1.5 text-[11.5px] font-medium transition-colors duration-300", i === density ? "text-white" : "text-white/45")}>
              <DensityGlyph i={i} />
              {d}
            </span>
          ))}
        </div>
      </div>
      <Divider y={ROW.badge} opacity={reveal[3]} />

      {/* Badge */}
      <div className="absolute inset-x-0 flex items-center justify-between" style={{ top: ROW.badge, height: 52, padding: `0 ${PX}px`, ...row(3) }}>
        <span className="flex items-center gap-2 text-[12px] font-medium text-white/80">
          Badge
          <span className="rounded-[4px] px-1.5 py-px text-[10px] font-semibold text-white transition-opacity duration-300" style={{ ...tint, background: a.hex, opacity: badge ? 1 : 0.35 }}>
            Fresh lot
          </span>
        </span>
        <span className="relative rounded-full transition-colors duration-300" style={{ width: TOGGLE.w, height: TOGGLE.h, background: badge ? "#F2F2F2" : "rgba(255,255,255,0.14)" }}>
          <span
            className="absolute top-[2px] size-[14px] rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.35)] transition-[left,background-color] duration-300 ease-[cubic-bezier(.22,1,.36,1)]"
            style={{ left: badge ? TOGGLE.w - 16 : 2, background: badge ? "#1C1C1C" : "#F2F2F2" }}
          />
        </span>
      </div>
    </div>
  )
}

const Divider = ({ y, opacity }: { y: number; opacity: number }) => <div className="absolute h-px bg-white/[0.06]" style={{ top: y, left: PX, right: PX, opacity }} />
