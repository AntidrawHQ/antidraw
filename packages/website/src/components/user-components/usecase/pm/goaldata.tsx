/**
 * "Real data, real logic" pieces, in the sprout brand (goals.tsx):
 *
 *  - ROWS        a sample of a real goals export: messy on purpose (a long
 *                name, a blank one, $0 saved, over target, gaps in `due`)
 *  - GoalSheet   the export as a spreadsheet card (goals_sample.csv); it can
 *                show a read pass, the agent's flags on the messy cells, and
 *                which rows the phone's search matches
 *  - GoalsData   GoalsList rebuilt on that data: a real total, search, sort;
 *                rows move as the filter and the sort play (props 0→1)
 *
 * GoalsData is 300×600 like the other frames; DATA_* points are frame px.
 */
import type { ReactNode } from "react"
import { Car, Check, FileSpreadsheet, Gift, Home, Laptop, Plane, Search, Umbrella } from "lucide-react"

import { cn } from "@/lib/utils"
import { DEEP, LIME, PALE } from "../../motion/mvf/fintech"

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`
const mix = (a: number, b: number, p: number) => a + (b - a) * p
const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/* ── The data ───────────────────────────────────────────────────────────── */

type Kind = "trip" | "tech" | "home" | "rainy" | "gift" | "car"
export type GoalRow = { name: string; kind: Kind; saved: number; target: number; due: string }

/** The first rows of the export (the sheet shows 12; the rest are "more rows"). */
export const ROWS: GoalRow[] = [
  { name: "Japan trip with Maya & Sam (spring '27)", kind: "trip", saved: 1240, target: 2000, due: "2027-03" },
  { name: "Lisbon trip", kind: "trip", saved: 2240, target: 2000, due: "2026-09" },
  { name: "", kind: "rainy", saved: 310, target: 500, due: "" },
  { name: "New laptop", kind: "tech", saved: 1100, target: 1300, due: "2026-12" },
  { name: "Road trip 🚐", kind: "trip", saved: 0, target: 1500, due: "2027-06" },
  { name: "House deposit", kind: "home", saved: 18400, target: 60000, due: "2029-01" },
  { name: "Emergency fund", kind: "rainy", saved: 4100, target: 10000, due: "" },
  { name: "Mexico City trip", kind: "trip", saved: 640, target: 3000, due: "2027-11" },
  { name: "Car repairs", kind: "car", saved: 300, target: 1200, due: "2026-11" },
  { name: "Gift for mum", kind: "gift", saved: 150, target: 150, due: "2026-10" },
  { name: "Rainy day", kind: "rainy", saved: 800, target: 2000, due: "" },
  { name: "Wedding", kind: "gift", saved: 5200, target: 15000, due: "2027-08" },
  { name: "Ski trip", kind: "trip", saved: 980, target: 1600, due: "2027-01" },
  { name: "Trip to see grandma", kind: "trip", saved: 300, target: 800, due: "2026-12" },
]
export const SHEET_ROWS = 12
export const TOTAL_ROWS = 412
export const TOTAL_SAVED = 184320
export const QUERY = "trip"
export const MATCH_COUNT = 38
export const MATCH_SAVED = 41870

export const matches = (r: GoalRow) => r.name.toLowerCase().includes(QUERY)
const progress = (r: GoalRow) => r.saved / r.target

/** The cells the agent flags while it reads: [row, column, note]. */
export const FLAGS: [number, keyof GoalRow, string][] = [
  [0, "name", "long name"],
  [1, "saved", "over target"],
  [2, "name", "no name"],
  [4, "saved", "$0 saved"],
]

/* ── The sheet ──────────────────────────────────────────────────────────── */

const COLS: { key: keyof GoalRow; w: number; num?: boolean }[] = [
  { key: "name", w: 176 },
  { key: "kind", w: 56 },
  { key: "saved", w: 62, num: true },
  { key: "target", w: 62, num: true },
  { key: "due", w: 68 },
]
const GUTTER = 28
export const SHEET_W = GUTTER + COLS.reduce((s, c) => s + c.w, 0)
const TITLE_H = 38
const ROW_H = 26
export const SHEET_H = TITLE_H + ROW_H * (SHEET_ROWS + 1) + 28
/** The file icon in the title bar (what the PM drags), in sheet px. */
export const SHEET_FILE_AT: [number, number] = [22, TITLE_H / 2]

const colX = (key: keyof GoalRow) => {
  let x = GUTTER
  for (const c of COLS) {
    if (c.key === key) return x
    x += c.w
  }
  return x
}

/**
 * `scan` 0→1 runs a read band down the rows (-1 off); `flags` is how many of
 * FLAGS are showing (`quiet` drops their notes once dealt with); `match`
 * 0→1 tints the rows the phone's search matches.
 */
export function GoalSheet({ scan = -1, flags = 0, quiet = false, match = 0, lifted = false, className }: { scan?: number; flags?: number; quiet?: boolean; match?: number; lifted?: boolean; className?: string }) {
  const bandY = TITLE_H + ROW_H + scan * ROW_H * (SHEET_ROWS - 1)
  return (
    <div className={cn("relative overflow-hidden rounded-[8px] bg-white font-sans text-[#1f2328] shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)]", className)} style={{ width: SHEET_W, height: SHEET_H }}>
      <div className="flex items-center gap-2 border-b border-black/[0.07] px-3" style={{ height: TITLE_H }}>
        <span className={cn("grid size-5 place-items-center rounded-[4px] bg-[#e6f4ea] transition-opacity duration-150", lifted && "opacity-30")}>
          <FileSpreadsheet size={13} className="text-[#188038]" strokeWidth={2} />
        </span>
        <span className="text-[12px] font-semibold">goals_sample.csv</span>
        <span className="ml-auto text-[10.5px] text-black/40 tabular-nums">{TOTAL_ROWS} rows · exported from Metabase</span>
      </div>
      <div className="relative text-[11px]">
        <div className="flex bg-[#f6f8fa] font-mono text-[10.5px] font-semibold text-black/55" style={{ height: ROW_H }}>
          <span className="shrink-0 border-r border-b border-black/[0.07]" style={{ width: GUTTER }} />
          {COLS.map((c) => (
            <span key={c.key} className={cn("flex shrink-0 items-center border-r border-b border-black/[0.07] px-2", c.num && "justify-end")} style={{ width: c.w }}>
              {c.key}
            </span>
          ))}
        </div>
        {ROWS.slice(0, SHEET_ROWS).map((r, i) => (
          <div key={i} className="relative flex" style={{ height: ROW_H }}>
            <div className="absolute inset-0 bg-[#3b82f6]" style={{ opacity: matches(r) ? match * 0.13 : 0 }} />
            <span className="relative grid shrink-0 place-items-center border-r border-b border-black/[0.07] bg-[#f6f8fa] font-mono text-[10px] text-black/35" style={{ width: GUTTER }}>
              {i + 2}
            </span>
            {COLS.map((c) => (
              <span
                key={c.key}
                className={cn("relative flex shrink-0 items-center overflow-hidden border-r border-b border-black/[0.07] px-2 whitespace-nowrap", c.num && "justify-end font-mono text-[10.5px] tabular-nums", c.key === "kind" && "text-black/50")}
                style={{ width: c.w }}
              >
                {String(r[c.key])}
              </span>
            ))}
          </div>
        ))}
        <div className="flex items-center px-3 text-[10.5px] text-black/40 tabular-nums" style={{ height: 28 }}>
          + {TOTAL_ROWS - SHEET_ROWS} more rows
        </div>
        {scan >= 0 && scan <= 1 && (
          <div className="pointer-events-none absolute inset-x-0 border-l-2 border-[#3b82f6] bg-[#3b82f6]/[0.10]" style={{ top: bandY - TITLE_H, height: ROW_H }} />
        )}
      </div>
      {FLAGS.slice(0, flags).map(([row, key, note]) => {
        const w = COLS.find((c) => c.key === key)!.w
        const x = colX(key)
        const y = TITLE_H + ROW_H * (row + 1)
        return (
          <div key={note} className="gd-pop pointer-events-none absolute" style={{ left: x, top: y, width: w + 1, height: ROW_H + 1 }}>
            <div className={cn("absolute inset-0 shadow-[inset_0_0_0_1.5px_#e8590c] transition-opacity duration-300", quiet && "opacity-35")} />
            <span className={cn("absolute -top-[9px] right-1 rounded-[4px] bg-[#e8590c] px-1.5 py-px text-[9.5px] leading-[14px] font-semibold whitespace-nowrap text-white shadow-[0_2px_6px_rgba(232,89,12,0.3)] transition-opacity duration-300", quiet && "opacity-0")}>
              {note}
            </span>
          </div>
        )
      })}
      <style>{`@keyframes gd-pop { from { opacity: 0; transform: scale(.9) } } .gd-pop { animation: gd-pop .28s cubic-bezier(.22,1,.36,1) both }`}</style>
    </div>
  )
}

/* ── GoalsList, on the data ─────────────────────────────────────────────── */

const ICONS = { trip: Plane, tech: Laptop, home: Home, rainy: Umbrella, gift: Gift, car: Car }
const TILE: Record<Kind, string> = { trip: "#4cc3ff", tech: "#ff4fd8", home: "#ffb020", rainy: "#3ddc4a", gift: "#ff6b5a", car: "#8b7bff" }

function KindIcon({ kind, size = 32 }: { kind: Kind; size?: number }) {
  const I = ICONS[kind]
  return (
    <span className="grid shrink-0 place-items-center rounded-[10px]" style={{ width: size, height: size, background: TILE[kind] }}>
      <I size={size * 0.45} color="#fff" strokeWidth={2.2} />
    </span>
  )
}

export const SORTS = ["Newest", "Progress", "Amount"]
const SORT_W = [70, 78, 72]
const SORT_X = (i: number) => 20 + SORT_W.slice(0, i).reduce((s, w) => s + w + 6, 0)
/** Centres of the search field and the sort chips, in frame px. */
export const DATA_SEARCH_AT: [number, number] = [150, 140]
export const DATA_SORT_AT = (i: number): [number, number] => [SORT_X(i) + SORT_W[i] / 2, 184]

const LIST_TOP = 214
const LIST_BOTTOM = 552
const STEP = 66

const ORDER = ROWS.map((_, i) => i)
const HITS = ORDER.filter((i) => matches(ROWS[i]))
const SORTED = [...HITS].sort((a, b) => progress(ROWS[b]) - progress(ROWS[a]))

function GoalCard({ r }: { r: GoalRow }) {
  const p = progress(r)
  const over = p >= 1
  return (
    <div className="h-[60px] rounded-[14px] bg-white px-3 pt-2.5 shadow-[0_4px_14px_rgba(13,74,18,0.06)]">
      <div className="flex items-center gap-2.5">
        <KindIcon kind={r.kind} size={28} />
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-[13px] leading-tight font-semibold", !r.name && "italic opacity-45")}>{r.name || "Untitled goal"}</div>
          <div className="mt-0.5 text-[10.5px] tabular-nums opacity-55">{r.saved === 0 ? `Not started · ${money(r.target)}` : `${money(r.saved)} of ${money(r.target)}`}</div>
        </div>
        {over ? (
          <span className="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums" style={{ background: LIME, color: DEEP }}>
            <Check size={10} strokeWidth={3.5} />
            {Math.round(p * 100)}%
          </span>
        ) : (
          <span className="text-[12px] font-bold tabular-nums">{Math.round(p * 100)}%</span>
        )}
      </div>
      <div className="mt-2 h-[5px] overflow-hidden rounded-full" style={{ background: "rgba(13,74,18,0.10)" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(1, p) * 100}%`, background: DEEP }} />
      </div>
    </div>
  )
}

/**
 * `query` is what's typed in search (`focus` shows the caret); `filter` 0→1
 * plays the search (misses fade, hits close up); `sort` 0→1 plays the
 * reorder by progress; `total` and `count` are the header's numbers.
 */
export function GoalsData({ query = "", focus = false, filter = 0, sort = 0, total = TOTAL_SAVED, count = TOTAL_ROWS }: { query?: string; focus?: boolean; filter?: number; sort?: number; total?: number; count?: number }) {
  const fade = c01(filter / 0.35)
  const move = c01((filter - 0.12) / 0.88)
  return (
    <div className="absolute inset-0 overflow-hidden font-sans" style={{ background: PALE, color: DEEP }}>
      <div className="flex justify-between px-5 pt-2.5 text-[11px] font-semibold">
        <span>9:41</span>
        <span>●●● ▮</span>
      </div>
      <div className="absolute inset-x-5 top-[42px]">
        <div className="flex items-baseline justify-between text-[12px] font-medium">
          <span className="opacity-60">Savings goals</span>
          <span className="tabular-nums opacity-45">{count} goals</span>
        </div>
        <div className="mt-0.5 text-[26px] leading-[1.1] font-black tracking-[-0.03em] tabular-nums">{money(total)} saved</div>
      </div>
      <div className="absolute inset-x-5 top-[118px] flex h-[42px] items-center gap-2 rounded-[12px] bg-white px-3" style={{ boxShadow: focus ? `inset 0 0 0 1.5px ${DEEP}` : "inset 0 0 0 1px rgba(13,74,18,0.14)" }}>
        <Search size={14} className="shrink-0 opacity-50" />
        <span className={cn("text-[13px]", !query && "opacity-40")}>{query || "Search goals"}</span>
        {focus && <span className="gd-caret -ml-1.5 h-[15px] w-px" style={{ background: DEEP }} />}
      </div>
      {SORTS.map((s, i) => {
        const on = sort > 0 ? i === 1 : i === 0
        return (
          <span
            key={s}
            className="absolute top-[169px] flex h-[30px] items-center justify-center rounded-full text-[12px] font-semibold transition-colors duration-200"
            style={{ left: SORT_X(i), width: SORT_W[i], ...(on ? { background: DEEP, color: LIME } : { background: "#fff", boxShadow: "inset 0 0 0 1px rgba(13,74,18,0.14)" }) }}
          >
            {s}
          </span>
        )
      })}
      <div className="absolute inset-x-0 overflow-hidden" style={{ top: LIST_TOP, height: LIST_BOTTOM - LIST_TOP, maskImage: "linear-gradient(to bottom, black 86%, transparent)" }}>
        {ORDER.map((i) => {
          const hit = HITS.indexOf(i)
          const at = hit < 0 ? i : mix(mix(i, hit, move), SORTED.indexOf(i), sort)
          const opacity = hit < 0 ? 1 - fade : 1
          if (opacity <= 0 || at * STEP > LIST_BOTTOM - LIST_TOP + 10) return null
          return (
            <div key={i} className="absolute inset-x-5" style={{ top: at * STEP, opacity, transform: hit < 0 ? `scale(${1 - 0.04 * fade})` : undefined }}>
              <GoalCard r={ROWS[i]} />
            </div>
          )
        })}
      </div>
      <Nav />
      <style>{`@keyframes gd-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .gd-caret { animation: gd-caret 1s step-end infinite }`}</style>
    </div>
  )
}

function Nav(): ReactNode {
  return (
    <div className="absolute inset-x-5 bottom-3 flex items-center justify-around rounded-full py-2 shadow-[0_6px_20px_rgba(0,0,0,0.10)]" style={{ background: DEEP, color: LIME }}>
      <Home size={14} />
      <span className="grid size-7 place-items-center rounded-full" style={{ background: LIME, color: DEEP }}>
        <Umbrella size={14} />
      </span>
      <Search size={14} />
      <Gift size={14} />
    </div>
  )
}
