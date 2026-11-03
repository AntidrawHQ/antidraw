/**
 * Pastel pieces for the canvas landing, each a loose take on a real app seen on Mobbin (not a copy):
 *
 *  - TidepodPlayer (300×600) a podcast player, after Brink's: big artwork, chips, a scrubber, ±30
 *  - BoardingCard  (300×170) a boarding widget, after American Airlines': the time, the route, a status pill
 *
 * `progress` (0–1) moves the player's scrubber.
 */
import { Bookmark, Captions, Moon, Pause, Plane, RotateCcw, RotateCw, SlidersHorizontal } from "lucide-react"

export const PLAYER_W = 300
export const PLAYER_H = 600
export const BOARD_W = 300
export const BOARD_H = 170

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

export function TidepodPlayer({ progress = 0.35 }: { progress?: number }) {
  const len = 42 * 60 + 18
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden px-5 pt-3 pb-6 font-sans text-[#33204a]" style={{ background: "linear-gradient(180deg, #f3e8ff 0%, #ffe4f1 100%)" }}>
      <div className="flex justify-between text-[11px] font-semibold">
        <span>9:41</span>
        <span>●●● ▮</span>
      </div>
      <div className="mx-auto mt-3 h-1 w-9 rounded-full bg-[#33204a]/15" />
      {/* The artwork: a pastel tide over a sun. */}
      <div className="relative mt-5 aspect-square overflow-hidden rounded-[22px] bg-[#c7d2fe] shadow-[0_18px_40px_-18px_rgba(51,32,74,0.45)]">
        <span className="absolute top-[18%] left-1/2 size-[46%] -translate-x-1/2 rounded-full bg-[#fde68a]" />
        <span className="absolute inset-x-[-10%] bottom-[22%] h-[30%] rounded-[50%] bg-[#a5f3fc]" />
        <span className="absolute inset-x-[-10%] bottom-[-6%] h-[36%] rounded-[50%] bg-[#f9a8d4]" />
        <span className="absolute top-4 left-4 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase">Ep. 41</span>
      </div>
      <div className="mt-5 text-[19px] leading-tight font-semibold tracking-[-0.01em]">The quiet art of tides</div>
      <div className="mt-0.5 text-[13px] opacity-60">Tidepod · Slow science</div>
      <div className="mt-3 flex gap-2 text-[11.5px] font-medium">
        {[
          [Bookmark, "3 bookmarks"],
          [Captions, "Transcript"],
        ].map(([Icon, t]) => {
          const I = Icon as typeof Bookmark
          return (
            <span key={t as string} className="flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1.5">
              <I className="size-3.5" />
              {t as string}
            </span>
          )
        })}
      </div>
      <div className="mt-auto">
        <div className="relative h-1.5 rounded-full bg-[#33204a]/12">
          <div className="absolute inset-y-0 left-0 rounded-full bg-[#33204a]" style={{ width: `${progress * 100}%` }} />
          <span className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#33204a] ring-[3px] ring-white" style={{ left: `${progress * 100}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10.5px] opacity-55">
          <span>{fmt(progress * len)}</span>
          <span>-{fmt((1 - progress) * len)}</span>
        </div>
        <div className="mt-3 flex items-center justify-between px-1">
          <SlidersHorizontal className="size-4 opacity-60" />
          <RotateCcw className="size-6" />
          <span className="grid size-14 place-items-center rounded-full bg-[#33204a] text-white">
            <Pause className="size-6 fill-current" />
          </span>
          <RotateCw className="size-6" />
          <Moon className="size-4 opacity-60" />
        </div>
      </div>
    </div>
  )
}

export function BoardingCard() {
  return (
    <div className="absolute inset-0 flex flex-col bg-[#fef9c3] p-4 font-sans text-[#2b2410]">
      <div className="flex items-start justify-between">
        <span className="text-[12px] font-medium opacity-70">Boards</span>
        <span className="rounded-[6px] bg-[#fb923c] px-2 py-0.5 text-[10.5px] font-bold tracking-[0.06em] text-white uppercase">Delayed</span>
      </div>
      <div className="mt-0.5 text-[34px] leading-none font-semibold tracking-[-0.03em] tabular-nums">
        10:49 <span className="text-[16px] font-medium">AM</span>
      </div>
      <div className="mt-auto flex items-center gap-2 text-[13px] font-semibold">
        LIS
        <span className="h-px flex-1 border-t border-dashed border-current opacity-40" />
        <Plane className="size-3.5" />
        <span className="h-px flex-1 border-t border-dashed border-current opacity-40" />
        CPH
      </div>
      <div className="mt-1 flex justify-between text-[11px] opacity-60">
        <span>Gate B22</span>
        <span>Seat 16D</span>
      </div>
    </div>
  )
}
