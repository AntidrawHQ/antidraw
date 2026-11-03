/**
 * The "sprout" fintech brand's pieces shared by MotionReuse and
 * MotionTransitions: palette, account rows, a rolling savings odometer, the
 * confetti popper and the spend bar. Progress values come in from each
 * scene's clock.
 */
import type { ReactNode } from "react"
import { ArrowLeftRight, Eye, ArrowDownToLine, Sparkles } from "lucide-react"

import { easeOut, springy } from "../mvb/stage"
import { MONO } from "./shared"

export const LIME = "#c6f432"
export const DEEP = "#0d4a12"
export const PALE = "#effcd2"

export const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export type Sp = (delay: number, dur?: number) => number

export function Accounts({ sp, eo }: { sp: Sp; eo: Sp }) {
  const rows = [
    { name: "Budget Buddy", tag: "#3ddc4a", fill: 0.72, color: "#16a34a" },
    { name: "Double Down", tag: "#4cc3ff", fill: 0.48, color: "#0ea5e9" },
    { name: "Stack Master", tag: "#ff4fd8", fill: 0.86, color: "#c026d3" },
  ]
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-2.5 px-6">
      {rows.map((row, i) => {
        const p = sp(0.05 + i * 0.08, 0.55)
        const f = eo(0.25 + i * 0.08, 0.7)
        return (
          <div key={row.name} className="flex h-[62px] items-center gap-3 rounded-[12px] bg-white px-3" style={{ transform: `translateX(${(1 - p) * 60}px)`, opacity: Math.min(1, 0.3 + p) }}>
            <div className="flex size-[40px] items-center justify-center rounded-[10px]" style={{ background: row.tag }}>
              <Sparkles size={18} color="#fff" style={{ transform: `rotate(${p * 90}deg)` }} />
            </div>
            <div className="flex-1">
              <div className="text-[13px] font-semibold text-[#122]">{row.name}</div>
              <div className="mt-1.5 h-[6px] overflow-hidden rounded-full bg-black/[0.07]">
                <div className="h-full rounded-full" style={{ width: `${row.fill * f * 100}%`, background: row.color }} />
              </div>
            </div>
            <span className="text-[11px] tabular-nums text-black/45" style={{ fontFamily: MONO }}>
              {Math.round(row.fill * f * 100)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function Digit({ v, h }: { v: number; h: number }) {
  return (
    <span className="relative inline-block overflow-hidden" style={{ height: h, width: "0.62em" }}>
      <span className="absolute left-0 top-0 flex flex-col" style={{ transform: `translateY(${-(v % 10) * h}px)` }}>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d, i) => (
          <span key={i} style={{ height: h, lineHeight: `${h}px` }}>
            {d}
          </span>
        ))}
      </span>
    </span>
  )
}

export function Savings({ p, sp, from = 20.5, to = 194.7 }: { p: number; sp: Sp; from?: number; to?: number }) {
  const value = from + (to - from) * p
  const cents = value * 100
  const big = 54
  // odometer carry: the cents column rolls freely; each higher column ticks
  // over only while the column below it is passing 9 → 0
  const place = (k: number): number => {
    const n = cents / Math.pow(10, k)
    if (k === 0) return n % 10
    return (Math.floor(n) + Math.max(0, place(k - 1) - 9)) % 10
  }
  const btn = sp(0.5, 0.5)
  return (
    <div className="absolute inset-5 rounded-[18px] p-5" style={{ background: DEEP }}>
      <div className="flex items-center justify-between text-[12px] text-white/65">
        Total savings
        <span className="flex size-[26px] items-center justify-center rounded-full" style={{ background: LIME }}>
          <Eye size={14} color={DEEP} />
        </span>
      </div>
      <div className="mt-3 flex items-start font-black tabular-nums tracking-[-0.03em]" style={{ color: LIME, fontSize: big, height: big + 4 }}>
        <span style={{ lineHeight: `${big}px` }}>$</span>
        <span style={{ opacity: c01((value - 90) / 12) }}>
          <Digit v={place(4)} h={big} />
        </span>
        <Digit v={place(3)} h={big} />
        <Digit v={place(2)} h={big} />
        <span className="text-[26px]" style={{ lineHeight: "40px" }}>
          .
        </span>
        <span className="flex text-[26px]">
          <Digit v={place(1)} h={34} />
          <Digit v={place(0)} h={34} />
        </span>
      </div>
      <div className="absolute bottom-5 left-5 right-5 grid grid-cols-2 gap-2.5">
        {[
          [<ArrowDownToLine size={14} />, "Deposit"],
          [<ArrowLeftRight size={14} />, "Transfer"],
        ].map(([icon, label], i) => (
          <div
            key={i}
            className="flex h-11 items-center justify-center gap-2 rounded-[12px] border text-[13px] font-semibold"
            style={{ borderColor: "rgba(198,244,50,0.35)", color: LIME, background: i === 0 ? "rgba(198,244,50,0.12)" : "transparent", transform: `scale(${0.92 + 0.08 * btn})` }}
          >
            {icon}
            {label as string}
          </div>
        ))}
      </div>
    </div>
  )
}

export const CONFETTI = Array.from({ length: 26 }, (_, i) => {
  const a = -Math.PI / 2 - 0.9 + (i / 25) * 1.8 + Math.sin(i * 12.9) * 0.12
  return {
    a,
    d: 90 + ((i * 37) % 70),
    s: 6 + (i % 4) * 2,
    c: ["#0d4a12", "#c6f432", "#ff4fd8", "#4cc3ff", "#8b5cf6"][i % 5],
    spin: (i % 2 ? 1 : -1) * (200 + i * 13),
    shape: i % 3,
  }
})

export function Popper({ t, r }: { t: number; r: number }) {
  const burst = c01((t - 0.18) / 1.1)
  const fly = easeOut(burst)
  const wob = springy(c01((t - 0.12) / 0.6))
  const fade = r * (burst > 0 ? 1 : 0)
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 m-auto size-[200px] rounded-[48px]" style={{ background: LIME, transform: `rotate(${12 * wob * r}deg) scale(${0.94 + 0.06 * wob * r})` }} />
      <svg className="absolute inset-0" width={260} height={308} viewBox="0 0 260 308" style={{ overflow: "visible" }}>
        <g transform={`translate(130 190) rotate(${-28 + (1 - wob * r) * 10})`}>
          {CONFETTI.map((c, i) => {
            const x = Math.cos(c.a) * c.d * fly
            const y = Math.sin(c.a) * c.d * fly + 70 * burst * burst
            return (
              <g key={i} transform={`translate(${x} ${y}) rotate(${c.spin * burst})`} opacity={fade * (1 - Math.max(0, burst - 0.75) * 2)}>
                {c.shape === 0 ? <rect x={-c.s / 2} y={-c.s / 4} width={c.s} height={c.s / 2} fill={c.c} /> : c.shape === 1 ? <circle r={c.s / 2.4} fill={c.c} /> : <path d={`M ${-c.s} 0 Q 0 ${-c.s} ${c.s} 0`} stroke={c.c} strokeWidth={2.5} fill="none" />}
              </g>
            )
          })}
          {/* cone */}
          <path d="M -26 0 L 26 0 L 6 110 L -6 110 Z" fill="#d7dde3" stroke={DEEP} strokeWidth={3} strokeLinejoin="round" />
          <path d="M -18 30 L 18 22 M -12 60 L 12 54 M -8 88 L 8 84" stroke="#9aa3ad" strokeWidth={5} strokeLinecap="round" />
          <ellipse cx={0} cy={0} rx={26} ry={7} fill="#f3f5f7" stroke={DEEP} strokeWidth={3} />
        </g>
      </svg>
    </div>
  )
}

export function SpendBar({ sp }: { sp: Sp }) {
  const segs = [
    { label: "Trips", v: 1.0, c: LIME, amt: "$412" },
    { label: "Entertainment", v: 0.38, c: "#4cdcf5", amt: "$156" },
    { label: "Food", v: 0.36, c: "#f472d0", amt: "$148" },
    { label: "Clothes", v: 0.22, c: "#a78bfa", amt: "$90" },
  ]
  // segments push in from the right, last first
  const ps = segs.map((_, i) => sp(0.12 + (segs.length - 1 - i) * 0.1, 0.6))
  const total = segs.reduce((a, s, i) => a + s.v * ps[i], 0) || 1
  return (
    <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-[14px] bg-white p-4">
      <div className="flex h-[96px] gap-1.5">
        {segs.map((s, i) => (
          <div
            key={s.label}
            className="flex items-end overflow-hidden rounded-[8px] p-2 text-[11px] font-semibold text-black/60"
            style={{ flexGrow: Math.max(0.0001, (s.v * ps[i]) / total), flexBasis: 0, background: s.c, opacity: c01(ps[i] * 3), transform: `scaleY(${0.7 + 0.3 * Math.min(1, ps[i])})`, transformOrigin: "bottom" }}
          >
            {ps[i] > 0.6 && s.amt}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-[11.5px] text-black/60">
        {segs.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5">
            <span className="size-[8px] rounded-full" style={{ background: s.c }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
