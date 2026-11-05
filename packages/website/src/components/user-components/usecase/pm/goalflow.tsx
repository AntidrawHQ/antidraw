/**
 * The new-goal flow in the sprout brand, built from the same kit as
 * goals.tsx: step 1 is GoalsStart, then GoalAmount, GoalReview, GoalDone.
 * 300×600 each; everything a scene taps sits at a fixed spot (FLOW_*), and
 * the pieces a transition moves between screens are exported as rects:
 *
 *  - The picked kind tile (START_TILE_RECT) grows into GoalAmount's header
 *    card (AMOUNT_HEAD); GoalAmount can hide its header and fade its body in.
 *  - GoalReview can sit as a sheet (REVIEW_SHEET_Y down, a grabber instead of
 *    the status bar), and its Create button collapses into a spinner.
 */
import type { CSSProperties, ReactNode } from "react"
import { Check, ChevronLeft } from "lucide-react"

import { cn } from "@/lib/utils"
import { DEEP, LIME, PALE } from "../../motion/mvf/fintech"
import { SpButton, SpCard, SpChip, SpIcon } from "./goals"

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`
const mix = (a: number, b: number, p: number) => a + (b - a) * p

export type Rect = { x: number; y: number; w: number; h: number; r: number }

/** Continue, at the same spot on Kind and Amount. */
export const FLOW_NEXT_AT: [number, number] = [150, 542]
export const AMOUNTS = [500, 1000, 2000]
export const FLOW_AMOUNT_AT = (i: number): [number, number] => [66 + i * 84, 335]

/** GoalsStart's first kind tile, and the header card it becomes. */
export const START_TILE_RECT: Rect = { x: 24, y: 176, w: 120, h: 92, r: 16 }
export const AMOUNT_HEAD: Rect = { x: 12, y: 36, w: 276, h: 168, r: 22 }

/** How far down the Review sheet sits, and where its Create button lands. */
export const REVIEW_SHEET_Y = 26
export const FLOW_CREATE_AT: [number, number] = [150, 542 + REVIEW_SHEET_Y]

const StatusBar = () => (
  <div className="flex justify-between px-5 pt-2.5 text-[11px] font-semibold">
    <span>9:41</span>
    <span>●●● ▮</span>
  </div>
)

function Step({ n, sheet, children }: { n: number; sheet?: boolean; children: ReactNode }) {
  return (
    <div className={cn("absolute inset-0 overflow-hidden font-sans", sheet && "rounded-t-[22px]")} style={{ background: PALE, color: DEEP }}>
      {sheet ? <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-black/15" /> : <StatusBar />}
      <div className="absolute inset-x-6 top-[44px]">
        <div className="flex items-center gap-1 text-[11.5px] font-semibold opacity-55">
          <ChevronLeft size={14} className="-ml-1" />
          Step {n} of 3
        </div>
        <div className="mt-2 flex gap-1.5">
          {[1, 2, 3].map((i) => (
            <span key={i} className="h-1 flex-1 rounded-full" style={{ background: i <= n ? DEEP : "rgba(13,74,18,0.12)" }} />
          ))}
        </div>
      </div>
      {children}
    </div>
  )
}

/**
 * The tile-to-header morph, drawn in frame px: `p` 0 is the picked tile on
 * Kind, 1 is GoalAmount's header card. The icon and the label travel with it.
 */
export function KindMorph({ p }: { p: number }) {
  const a = START_TILE_RECT
  const b = AMOUNT_HEAD
  const pad = mix(12, 20, p)
  const icon = mix(30, 36, p)
  const style: CSSProperties = { left: mix(a.x, b.x, p), top: mix(a.y, b.y, p), width: mix(a.w, b.w, p), height: mix(a.h, b.h, p), borderRadius: mix(a.r, b.r, p), background: DEEP, color: LIME }
  return (
    <div className="absolute overflow-hidden font-sans shadow-[0_12px_30px_rgba(13,74,18,0.25)]" style={style}>
      <div className="absolute" style={{ left: pad, top: pad }}>
        <SpIcon icon="trip" size={icon} />
      </div>
      <span className="absolute text-[13px] font-semibold whitespace-nowrap" style={{ left: pad, bottom: pad, opacity: 1 - Math.min(1, p * 2.2) }}>
        A trip
      </span>
      <span className="absolute text-[24px] leading-[1.1] font-black tracking-[-0.03em] whitespace-nowrap" style={{ left: pad, bottom: pad, opacity: Math.max(0, p * 2 - 1) }}>
        How much for A trip?
      </span>
    </div>
  )
}

/** `amount` is shown (tween it); `chip` is the picked preset. `header` false leaves room for KindMorph; `body` fades the rest. */
export function GoalAmount({ amount = 1000, chip = 1, header = true, body = 1 }: { amount?: number; chip?: number; header?: boolean; body?: number }) {
  const h = AMOUNT_HEAD
  return (
    <div className="absolute inset-0 overflow-hidden font-sans" style={{ background: PALE, color: DEEP }}>
      <StatusBar />
      {header && (
        <div className="absolute overflow-hidden" style={{ left: h.x, top: h.y, width: h.w, height: h.h, borderRadius: h.r, background: DEEP, color: LIME }}>
          <div className="absolute top-5 left-5">
            <SpIcon icon="trip" size={36} />
          </div>
          <span className="absolute top-6 right-5 text-[11.5px] font-semibold opacity-60">Step 2 of 3</span>
          <span className="absolute bottom-5 left-5 text-[24px] leading-[1.1] font-black tracking-[-0.03em]">How much for A trip?</span>
        </div>
      )}
      <div className="absolute inset-0" style={{ opacity: body, transform: `translateY(${(1 - body) * 14}px)` }}>
        <div className="absolute inset-x-0 top-[226px] text-center">
          <div className="text-[46px] leading-none font-black tracking-[-0.04em] tabular-nums">{money(amount)}</div>
          <div className="mt-2 text-[12px] font-medium tabular-nums opacity-55">by March · {money(amount / 12)} a month</div>
        </div>
        <div className="absolute top-[318px] left-[28px] flex gap-2">
          {AMOUNTS.map((a, i) => (
            <SpChip key={a} selected={chip === i} className="w-[76px]">
              {money(a)}
            </SpChip>
          ))}
        </div>
        <div className="absolute inset-x-6 top-[380px]">
          <div className="mb-2 text-[12px] font-semibold opacity-60">By</div>
          <div className="flex gap-2">
            {["December", "March", "June"].map((m) => (
              <SpChip key={m} selected={m === "March"} className="flex-1 !text-[12px]">
                {m}
              </SpChip>
            ))}
          </div>
        </div>
        <SpButton className="absolute inset-x-6 top-[520px]">Continue</SpButton>
      </div>
    </div>
  )
}

/** `collapse` 0→1 shrinks Create goal into a round spinner; `sheet` drops the status bar for a grabber; `amount` is the target. */
export function GoalReview({ collapse = 0, sheet = false, amount = 2000 }: { collapse?: number; sheet?: boolean; amount?: number }) {
  const rows: [string, string][] = [
    ["Target", money(amount)],
    ["By", "March 2027"],
    ["Each month", money(amount / 12)],
    ["Starting with", "$0"],
  ]
  const w = mix(252, 44, collapse)
  return (
    <Step n={3} sheet={sheet}>
      <div className="absolute inset-x-6 top-[92px] text-[23px] leading-[1.15] font-black tracking-[-0.03em]">Look right?</div>
      <SpCard className="absolute inset-x-6 top-[148px] !p-4">
        <div className="flex items-center gap-3">
          <SpIcon icon="trip" />
          <div className="text-[16px] font-bold">Japan trip</div>
        </div>
        <div className="mt-3 flex flex-col">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between border-t border-black/[0.06] py-2.5 text-[13px]">
              <span className="opacity-55">{k}</span>
              <span className="font-semibold tabular-nums">{v}</span>
            </div>
          ))}
        </div>
      </SpCard>
      <span
        className="absolute top-[520px] flex h-11 items-center justify-center overflow-hidden text-[13.5px] font-semibold"
        style={{ left: 24 + (252 - w) / 2, width: w, borderRadius: mix(12, 22, collapse), background: DEEP, color: LIME }}
      >
        <span className="whitespace-nowrap" style={{ opacity: 1 - Math.min(1, collapse * 2.5) }}>
          Create goal
        </span>
        <span className="absolute size-[18px] animate-spin rounded-full border-2 border-current border-t-transparent" style={{ opacity: Math.max(0, collapse * 2 - 1) }} />
      </span>
    </Step>
  )
}

/** `p` 0→1 plays the arrival: the ring draws, the tick pops, the copy rises; `amount` is the target. */
export function GoalDone({ p = 1, amount = 2000 }: { p?: number; amount?: number }) {
  const R = 54
  const C = 2 * Math.PI * R
  const ring = Math.min(1, p / 0.6)
  const pop = Math.max(0, Math.min(1, (p - 0.45) / 0.35))
  const copy = Math.max(0, Math.min(1, (p - 0.55) / 0.45))
  return (
    <div className="absolute inset-0 overflow-hidden font-sans" style={{ background: PALE, color: DEEP }}>
      <StatusBar />
      <div className="absolute top-[110px] left-1/2 -translate-x-1/2" style={{ width: 2 * R + 16, height: 2 * R + 16 }}>
        <svg width={2 * R + 16} height={2 * R + 16} className="-rotate-90">
          <circle cx={R + 8} cy={R + 8} r={R} fill="none" stroke="rgba(13,74,18,0.10)" strokeWidth={10} />
          <circle cx={R + 8} cy={R + 8} r={R} fill="none" stroke={DEEP} strokeWidth={10} strokeLinecap="round" strokeDasharray={`${C * ring} ${C}`} />
        </svg>
        <span className="absolute inset-0 m-auto grid size-[64px] place-items-center rounded-full" style={{ background: DEEP, color: LIME, transform: `scale(${pop < 1 ? pop * 1.15 : 1})`, opacity: pop }}>
          <Check size={30} strokeWidth={3} />
        </span>
      </div>
      <div className="absolute inset-x-6 top-[268px] text-center" style={{ opacity: copy, transform: `translateY(${(1 - copy) * 10}px)` }}>
        <div className="text-[24px] leading-[1.15] font-black tracking-[-0.03em]">Japan trip is set</div>
        <p className="m-0 mt-2 text-[13px] leading-[1.5] opacity-60">{money(amount)} by March. We'll remind you on the 1st of each month.</p>
      </div>
      <div className="absolute inset-x-6 top-[470px] flex flex-col gap-2.5" style={{ opacity: copy }}>
        <SpButton>Add your first $50</SpButton>
        <SpButton variant="secondary">Back to goals</SpButton>
      </div>
    </div>
  )
}
