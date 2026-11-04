/**
 * "FernhollowStay": a cabin-booking screen for a made-up stay, with the
 * three things the Comments story changes taken as props: the title's
 * weight/size (`bold` 0→1), the hero photo (motion/make/photos.tsx Photo,
 * forest → lake, crossfaded by `lake`), and the booking button (`green`
 * 0→1, with its new label). Natural size 300×600.
 */
import { CalendarDays, MapPin, Star, Wifi, Flame, Waves } from "lucide-react"

import { Photo } from "../../motion/make/photos"
import { mix } from "../../motion/canvas-ai/kit"

const lerpColor = (a: string, b: string, p: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `rgb(${pa.map((v, i) => Math.round(mix(v, pb[i], p))).join(",")})`
}

export function FernhollowStay({ bold = 0, lake = 0, green = 0, night = false }: { bold?: number; lake?: number; green?: number; night?: boolean }) {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#f6f3ee] font-sans text-[#1d1b17]">
      <div className="absolute inset-x-0 top-0 h-[250px]">
        <Photo kind={night ? "stars" : "forest"} className="absolute inset-0" />
        <Photo kind="water" className="absolute inset-0" style={{ opacity: lake }} />
        <div className="absolute inset-x-0 top-0 flex justify-between px-5 pt-2.5 text-[11px] font-semibold text-white">
          <span>9:41</span>
          <span>●●● ▮</span>
        </div>
        <span className="absolute right-4 bottom-4 rounded-full bg-black/35 px-2.5 py-1 text-[10.5px] font-medium text-white backdrop-blur">1 / 12</span>
      </div>
      <div className="absolute inset-x-0 top-[234px] bottom-0 rounded-t-[20px] bg-[#f6f3ee] px-5 pt-5" style={night ? { filter: "invert(1) hue-rotate(180deg)" } : undefined}>
        <div className="flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] text-black/45">
          <MapPin size={10} /> {lake > 0.5 ? "CABIN · LAKE WINDMERE" : "CABIN · FERN VALLEY"}
        </div>
        <div className="mt-1.5 leading-[1.05] tracking-[-0.03em]" style={{ fontSize: mix(21, 30, bold), fontWeight: Math.round(mix(500, 800, bold) / 100) * 100 }}>
          Fernhollow Cabin
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-black/55">
          <Star size={11} className="fill-[#e0a526] text-[#e0a526]" /> 4.92 · 214 stays
        </div>
        <p className="mt-3 text-[12.5px] leading-[19px] text-black/65">A timber cabin at the end of a quiet track, with a wood stove and a deck over the water.</p>
        <div className="mt-3.5 flex gap-1.5">
          {[
            [Flame, "Wood stove"],
            [Wifi, "Wi-Fi"],
            [Waves, "Lake access"],
          ].map(([I, l], i) => {
            const Icon = I as typeof Flame
            return (
              <span key={i} className="flex items-center gap-1 rounded-full bg-black/[0.05] px-2 py-1 text-[10.5px] text-black/60">
                <Icon size={10} /> {l as string}
              </span>
            )
          })}
        </div>
        <div className="mt-4 flex items-center gap-2.5 rounded-[12px] bg-white px-3 py-2.5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          <CalendarDays size={14} className="text-black/50" />
          <span className="flex-1 text-[12px] font-medium">Fri 14 – Sun 16 Nov</span>
          <span className="text-[11px] text-black/45">2 guests</span>
        </div>
        <div className="absolute inset-x-5 bottom-5 flex items-center justify-between">
          <div>
            <div className="text-[17px] font-semibold tracking-[-0.02em]">$184</div>
            <div className="text-[10.5px] text-black/45">per night</div>
          </div>
          <span className="flex h-11 items-center rounded-[12px] px-4 text-[13px] font-semibold text-white" style={{ background: lerpColor("#1d1b17", "#2f7a4b", green) }}>
            {green > 0.5 ? "Book 2 nights" : "Reserve"}
          </span>
        </div>
      </div>
    </div>
  )
}
