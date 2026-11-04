/**
 * The museum app screens used by MotionRoundTrip: the home screen (which the
 * scene edits: an Explore card joins Get tickets, the What's On image grows
 * into a SPACESHIP hero) and the floor-map screen beside it.
 */
import { ArrowRight, Asterisk, Bell, Home, Map, Search, User } from "lucide-react"

import type { CSSProperties } from "react"

import { clamp, mix, outCubic, spring } from "./kit"

const Status = () => (
  <div className="flex justify-between px-5 pt-2.5 text-[11px] font-semibold text-[#111]">
    <span>9:41</span>
    <span>●●● ▮</span>
  </div>
)

const TabBar = () => (
  <div className="absolute inset-x-5 bottom-3 flex items-center justify-around rounded-full bg-white/90 py-2 text-[#333] shadow-[0_6px_20px_rgba(0,0,0,0.12)] backdrop-blur">
    <span className="flex size-7 items-center justify-center rounded-full bg-[#dbe5ff]">
      <Home size={14} />
    </span>
    <Search size={14} />
    <Map size={14} />
    <Bell size={14} />
    <User size={14} />
  </div>
)

export function Dome({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div className={className} style={{ background: "linear-gradient(180deg,#b9c7d6 0%,#e7e2da 55%,#c9b38f 56%,#b39a74 100%)", overflow: "hidden", ...style }}>
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full">
        <ellipse cx="100" cy="92" rx="70" ry="9" fill="rgba(70,50,20,0.25)" />
        <path d="M40 90 Q40 30 100 26 Q160 30 160 90 Z" fill="#f2f0ec" stroke="#fff" strokeWidth="2" />
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M${52 + i * 8} 90 Q${60 + i * 6} ${44 + i * 6} 100 ${36 + i * 8}`} fill="none" stroke="#d9d4cc" strokeWidth="1.5" />
        ))}
        <rect x="88" y="70" width="24" height="20" rx="10" fill="#8e8778" />
      </svg>
    </div>
  )
}

/**
 * `explore` 0→1 slides an Explore card in beside Get tickets; `hero` 0→1
 * grows the What's On image into the SPACESHIP hero, `heroText` letters typed.
 */
export function MuseumHome({ explore = 0, hero = 0, heroText = 0 }: { explore?: number; hero?: number; heroText?: number }) {
  const e = spring(explore, 0.3)
  const h = outCubic(hero)
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#dfe7ff] font-sans text-[#111]">
      <Status />
      <div className="mt-4 flex items-start justify-between px-5">
        <h2 className="text-[25px] leading-[1.02] font-extrabold tracking-tight">
          Museum of
          <br />
          Speculative
          <br />
          Futures
        </h2>
        <Asterisk size={28} strokeWidth={2.4} />
      </div>
      <div className="absolute inset-x-0 top-[132px] bottom-0 rounded-t-[22px] bg-white px-4 pt-4">
        <div className="flex gap-2">
          <div className="flex h-[70px] flex-col justify-between rounded-[12px] bg-[#f1f2f4] p-2.5 text-[11px] font-semibold" style={{ width: `${mix(100, 50, e)}%` }}>
            Get tickets
            <ArrowRight size={15} />
          </div>
          {explore > 0 && (
            <div className="flex h-[70px] flex-col justify-between rounded-[12px] bg-[#f1f2f4] p-2.5 text-[11px] font-semibold" style={{ width: `${mix(0, 50, e)}%`, opacity: clamp(explore * 3), transform: `scale(${mix(0.7, 1, e)})` }}>
              Explore
              <ArrowRight size={15} />
            </div>
          )}
        </div>
        <div className="mt-4 font-mono text-[9px] text-black/50">[EVENTS]</div>
        <div className="overflow-hidden" style={{ height: mix(132, 0, h), opacity: 1 - h }}>
          {[
            ["07.10.2026", "Opening Day Preview: Metamaterial"],
            ["08.08.2026", "Artist Talk: Haashim Chouhdry on his latest installation"],
          ].map(([d, l]) => (
            <div key={d} className="flex items-center gap-2 border-b border-black/[0.06] py-2.5">
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="font-mono text-[9px] text-black/50">{d}</span>
                <span className="text-[11px] leading-tight font-semibold">{l}</span>
              </span>
              <Dome className="relative h-[44px] w-[52px] shrink-0 rounded-[8px]" />
            </div>
          ))}
        </div>
        <div className="mt-3 font-mono text-[9px] text-black/50">[WHAT&apos;S ON]</div>
        <div className="relative mt-2 overflow-hidden rounded-[14px]" style={{ height: mix(80, 250, h) }}>
          <Dome className="absolute inset-0" />
          {heroText > 0 && (
            <div className="absolute inset-x-0 bottom-0 bg-white px-3 pt-2 pb-12">
              <div className="font-mono text-[9px] text-black/50">NOW SHOWING</div>
              <span className="mt-0.5 inline-block bg-[#f3f66a] px-1 text-[30px] leading-none font-black tracking-tight">{"SPACESHIP".slice(0, heroText)}</span>
            </div>
          )}
        </div>
      </div>
      <TabBar />
    </div>
  )
}

const PINS: [string, number, number][] = [
  ["F", 92, 30],
  ["E", 58, 58],
  ["A", 130, 64],
  ["D", 72, 104],
  ["C", 30, 120],
  ["A", 108, 126],
  ["H", 150, 134],
  ["B", 54, 154],
  ["A", 140, 170],
]

/** The floor-map screen; `draw` 0→1 strokes the plan in. */
export function MuseumMap({ draw = 1 }: { draw?: number }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-white font-sans text-[#111]">
      <Status />
      <div className="mx-4 mt-3 flex items-center gap-2 rounded-full border border-black/10 px-3 py-1.5 text-[11px] text-black/40">
        <Search size={12} /> Search
      </div>
      <div className="mt-2.5 flex gap-1.5 px-4 text-[9.5px]">
        {["All", "Technology", "Fashion", "Bio Art"].map((c, i) => (
          <span key={c} className="rounded-full border border-black/10 px-2 py-0.5" style={{ background: i === 0 ? "#dbe5ff" : undefined }}>
            {c}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 180 200" className="mx-auto mt-2 block w-[86%]">
        {[0, 1, 2, 3, 4].map((i) => {
          const x = 20 + (i % 3) * 44
          const y = 30 + i * 30
          return (
            <path
              key={i}
              d={`M${x} ${y} l40 -20 l40 20 l-40 20 z M${x} ${y} v10 l40 20 l40 -20 v-10`}
              fill="none"
              stroke="#333"
              strokeWidth="1.1"
              pathLength={1}
              strokeDasharray="1 1"
              strokeDashoffset={1 - clamp(draw * 1.4 - i * 0.1)}
            />
          )
        })}
        {PINS.map(([l, x, y], i) => {
          const p = clamp(draw * 2 - 1 - i * 0.05)
          return (
            <g key={i} opacity={p} transform={`translate(${x} ${y - (1 - p) * 6})`}>
              <line x1="0" y1="0" x2="0" y2="10" stroke="#7aa0ff" strokeWidth="1" />
              <circle r="6" fill={l === "F" ? "#111" : "#dbe5ff"} stroke="#7aa0ff" strokeWidth="0.8" />
              <text y="2.4" textAnchor="middle" fontSize="6.5" fontWeight="700" fill={l === "F" ? "#fff" : "#3657c9"}>
                {l}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="absolute inset-x-4 bottom-16 flex overflow-hidden rounded-[14px] bg-[#f1f2f4]">
        <div className="h-[86px] w-[86px] shrink-0" style={{ background: "radial-gradient(circle at 50% 30%,#ff9ad5,#7b5cff 50%,#1b1b3a)" }} />
        <div className="flex flex-col justify-center px-3">
          <span className="text-[9px] text-black/50">Ana Voss</span>
          <span className="text-[17px] leading-[0.95] font-black tracking-tight">
            THE QUIET
            <br />
            SPECTRUM
          </span>
        </div>
      </div>
      <TabBar />
    </div>
  )
}

