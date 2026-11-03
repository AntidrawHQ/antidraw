/**
 * "Mockups with their data" pieces. The product is Tally (demo.tsx's made-up
 * staffing & ops dashboard); the prospect is Kestrel Climbing, six climbing
 * gyms across Oregon and Washington (made up too).
 *
 *  - KestrelMark   Kestrel's logo: two peaks and a bird, in their orange
 *  - LogoTile      kestrel-logo.png as an image on the canvas; it can show
 *                  the two colours the agent reads off it
 *  - GymSheet      kestrel_gyms.csv as a spreadsheet card; a read pass, and
 *                  the rows light up as they land in the product
 *  - ImageChip     an attached image, in the composer and on the sent message
 *  - TallyLocations Tally's Locations screen. It re-skins in place: the brand
 *                  in the nav, a colour sweep (`sweep` 0→1, Tally under,
 *                  Kestrel over), then the rows and numbers swap one by one
 *                  (`fill` 0→1). A row opens its detail drawer (`drawer`).
 *
 * TallyLocations is DASH_W×DASH_H at stage size; DASH_* points are in its px.
 */
import type { CSSProperties, ReactNode } from "react"
import { CalendarDays, FileSpreadsheet, Plus, Search, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { TallyMark } from "./demo"

const mix = (a: number, b: number, p: number) => a + (b - a) * p
const c01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const num = (n: number) => Math.round(n).toLocaleString("en-US")

/* ── Kestrel's brand ─────────────────────────────────────────────────── */

export const ORANGE = "#E4572E"
export const SLATE = "#17202B"
export const KESTREL_FILE = "kestrel-logo.png"
export const GYMS_FILE = "kestrel_gyms.csv"

/** Kestrel's mark: two peaks and a bird over them, on an orange disc. */
export function KestrelMark({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className="shrink-0" aria-hidden="true">
      <circle cx="20" cy="20" r="20" fill={ORANGE} />
      <path d="M6.5 29 L15.5 16.5 L20 22.5 L24.5 17.5 L33.5 29 Z" fill="#fff" />
      <path d="M15.5 16.5 L18.3 20.3 L15.5 19 L12.9 20.1 Z" fill={ORANGE} opacity=".9" />
      <path d="M21.5 11.2 q2.4 -2 4.6 0.4 q2.2 -2.4 4.6 -0.4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ── kestrel-logo.png, on the canvas ─────────────────────────────────── */

export const TILE = 160
/** The mark's centre and size inside the tile (where the flying copy starts). */
export const TILE_MARK_AT: [number, number] = [TILE / 2, 58]
export const TILE_MARK_SIZE = 58

const SWATCHES = [
  { hex: ORANGE, name: "#E4572E" },
  { hex: SLATE, name: "#17202B" },
]

/** `swatches` is how many of the read colours are showing; `lifted` dims it while it's dragged. */
export function LogoTile({ swatches = 0, lifted = false }: { swatches?: number; lifted?: boolean }) {
  return (
    <div className="font-sans">
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">{KESTREL_FILE}</div>
      <div className={cn("relative overflow-hidden rounded-[8px] bg-[#faf7f2] shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)] transition-opacity duration-150", lifted && "opacity-45")} style={{ width: TILE, height: TILE }}>
        <div className="absolute" style={{ left: TILE_MARK_AT[0] - TILE_MARK_SIZE / 2, top: TILE_MARK_AT[1] - TILE_MARK_SIZE / 2 }}>
          <KestrelMark size={TILE_MARK_SIZE} />
        </div>
        <div className="absolute inset-x-0 top-[96px] text-center leading-none" style={{ color: SLATE }}>
          <div className="text-[15px] font-extrabold tracking-[0.16em]">KESTREL</div>
          <div className="mt-1 text-[8.5px] font-semibold tracking-[0.42em] opacity-60">CLIMBING</div>
        </div>
        <div className="absolute inset-x-2 bottom-2 flex justify-center gap-1">
          {SWATCHES.slice(0, swatches).map((s) => (
            <span key={s.hex} className="km-pop flex items-center gap-1 rounded-[4px] bg-white px-1.5 py-[3px] font-mono text-[9.5px] leading-none font-semibold text-[#3a3a3a] shadow-[0_2px_6px_rgba(0,0,0,0.12)]">
              <span className="size-2 rounded-full" style={{ background: s.hex }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>
      <style>{`@keyframes km-pop { from { opacity: 0; transform: scale(.85) } } .km-pop { animation: km-pop .28s cubic-bezier(.22,1,.36,1) both }`}</style>
    </div>
  )
}

/** An attached image as a chip (thread.tsx FileChip, with a thumbnail). */
export function ImageChip({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-white/[0.06] pr-2 pl-1 text-xs font-medium text-white/60", className)}>
      <span className="grid size-4 shrink-0 place-items-center rounded-[3px] bg-[#faf7f2]">
        <KestrelMark size={12} />
      </span>
      <span className="truncate">{name}</span>
    </span>
  )
}

/* ── The data ────────────────────────────────────────────────────────── */

type Status = "Open" | "Quiet" | "Steady" | "Busy" | "Full"
export type Site = { name: string; city: string; members: number; today: number; wall: number; status: Status }

/** Tally's seed data: what every demo starts with. */
const SEED: Site[] = [
  { name: "Site 01", city: "Anytown, USA", members: 1200, today: 240, wall: 0.5, status: "Open" },
  { name: "Site 02", city: "Anytown, USA", members: 1000, today: 200, wall: 0.4, status: "Open" },
  { name: "Site 03", city: "Anytown, USA", members: 1500, today: 300, wall: 0.6, status: "Open" },
  { name: "Site 04", city: "Anytown, USA", members: 800, today: 160, wall: 0.3, status: "Open" },
  { name: "Site 05", city: "Anytown, USA", members: 1100, today: 220, wall: 0.45, status: "Open" },
  { name: "Site 06", city: "Anytown, USA", members: 900, today: 180, wall: 0.35, status: "Open" },
]

/** kestrel_gyms.csv: Kestrel's six gyms, this Saturday. */
export const GYMS: Site[] = [
  { name: "The Foundry", city: "Portland, OR", members: 2184, today: 412, wall: 0.86, status: "Busy" },
  { name: "Ballard Wall", city: "Seattle, WA", members: 1915, today: 366, wall: 0.92, status: "Full" },
  { name: "Eastside", city: "Portland, OR", members: 1762, today: 338, wall: 0.71, status: "Steady" },
  { name: "Cascade Bouldering", city: "Bend, OR", members: 940, today: 187, wall: 0.64, status: "Steady" },
  { name: "Riverfront", city: "Spokane, WA", members: 802, today: 141, wall: 0.48, status: "Quiet" },
  { name: "Tacoma Annex", city: "Tacoma, WA", members: 655, today: 118, wall: 0.39, status: "Quiet" },
]

const sum = (rows: Site[], k: "members" | "today") => rows.reduce((s, r) => s + r[k], 0)
const KPI_FROM = [sum(SEED, "today"), sum(SEED, "members"), 18, 22]
const KPI_TO = [sum(GYMS, "today"), sum(GYMS, "members"), 46, 52]
const DELTA_FROM = ["+5%", "+120 this month", "4 open shifts"]
const DELTA_TO = ["+12% on last Sat", "+86 this month", "6 open shifts"]

/** How far row i's swap has played for an overall `fill` (rows overlap a little). */
const LAG = 0.55
export const rowP = (fill: number, i: number) => c01(fill * (1 + (GYMS.length - 1) * LAG) - i * LAG)

/* ── kestrel_gyms.csv ────────────────────────────────────────────────── */

const SCOLS: { key: keyof Site; head: string; w: number; num?: boolean }[] = [
  { key: "name", head: "gym", w: 156 },
  { key: "city", head: "city", w: 118 },
  { key: "members", head: "members", w: 84, num: true },
  { key: "today", head: "checkins_today", w: 118, num: true },
  { key: "wall", head: "on_wall", w: 74, num: true },
]
const GUTTER = 28
const S_TITLE = 32
const S_ROW = 22
const S_SHOWN = 4
export const SHEET_W = 616
export const SHEET_H = S_TITLE + S_ROW * (S_SHOWN + 1) + 18
/** The file icon in the title bar (what the rep drags), in sheet px. */
export const SHEET_FILE_AT: [number, number] = [22, S_TITLE / 2]

/** `scan` 0→1 runs a read band down the rows (-1 off); `lit` is how many rows have landed in the product. */
export function GymSheet({ scan = -1, lit = 0, lifted = false }: { scan?: number; lit?: number; lifted?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[8px] bg-white font-sans text-[#1f2328] shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)]" style={{ width: SHEET_W, height: SHEET_H }}>
      <div className="flex items-center gap-2 border-b border-black/[0.07] px-3" style={{ height: S_TITLE }}>
        <span className={cn("grid size-5 place-items-center rounded-[4px] bg-[#e6f4ea] transition-opacity duration-150", lifted && "opacity-30")}>
          <FileSpreadsheet size={13} className="text-[#188038]" strokeWidth={2} />
        </span>
        <span className="text-[12px] font-semibold">{GYMS_FILE}</span>
        <span className="ml-auto text-[10.5px] text-black/40">6 rows · from Kestrel's ops lead</span>
      </div>
      <div className="relative text-[11px]">
        <div className="flex bg-[#f6f8fa] font-mono text-[10.5px] font-semibold text-black/55" style={{ height: S_ROW }}>
          <span className="shrink-0 border-r border-b border-black/[0.07]" style={{ width: GUTTER }} />
          {SCOLS.map((c) => (
            <span key={c.key} className={cn("flex shrink-0 items-center border-r border-b border-black/[0.07] px-2", c.num && "justify-end")} style={{ width: c.w }}>
              {c.head}
            </span>
          ))}
          <span className="flex-1 border-b border-black/[0.07]" />
        </div>
        {GYMS.slice(0, S_SHOWN).map((r, i) => (
          <div key={r.name} className="relative flex" style={{ height: S_ROW }}>
            <div className="absolute inset-0 transition-opacity duration-300" style={{ background: ORANGE, opacity: i < lit ? 0.1 : 0 }} />
            <span className="relative grid shrink-0 place-items-center border-r border-b border-black/[0.07] bg-[#f6f8fa] font-mono text-[10px] text-black/35" style={{ width: GUTTER }}>
              {i + 2}
            </span>
            {SCOLS.map((c) => (
              <span key={c.key} className={cn("relative flex shrink-0 items-center overflow-hidden border-r border-b border-black/[0.07] px-2 whitespace-nowrap", c.num && "justify-end font-mono text-[10.5px] tabular-nums")} style={{ width: c.w }}>
                {String(r[c.key])}
              </span>
            ))}
            <span className="relative flex-1 border-b border-black/[0.07]" />
          </div>
        ))}
        <div className="flex items-center px-3 text-[10.5px] text-black/40" style={{ height: 18 }}>
          + {GYMS.length - S_SHOWN} more rows
        </div>
        {scan >= 0 && scan <= 1 && (
          <div className="pointer-events-none absolute inset-x-0 border-l-2 border-[#3b82f6] bg-[#3b82f6]/[0.10]" style={{ top: S_ROW + scan * S_ROW * (S_SHOWN - 1), height: S_ROW }} />
        )}
      </div>
    </div>
  )
}

/* ── Skins ───────────────────────────────────────────────────────────── */

type Skin = {
  mark: ReactNode
  brand: string
  bar: string
  barInk: string
  barMuted: string
  barLine: string
  tabOn: string
  tabOnInk: string
  field: string
  accent: string
  soft: string
  hover: string
  title: string
  sub: string
  cta: string
  cols: string[]
  kpis: string[]
  status: Record<Status, [string, string]>
}

const GREY: [string, string] = ["#f1f1f5", "#787889"]

const TALLY_SKIN: Skin = {
  mark: <TallyMark size={24} />,
  brand: "Tally",
  bar: "#ffffff",
  barInk: "#16161f",
  barMuted: "#787889",
  barLine: "#ebebf0",
  tabOn: "#eeedfd",
  tabOnInk: "#4f46e5",
  field: "#ebebf0",
  accent: "#4f46e5",
  soft: "#e0defc",
  hover: "#f5f5ff",
  title: "Locations",
  sub: "6 sites · Saturday, Oct 17",
  cta: "Add location",
  cols: ["Location", "City", "Customers", "Visits today", "Capacity", "Status"],
  kpis: ["Visits today", "Customers", "Staff on shift"],
  status: { Open: GREY, Quiet: GREY, Steady: GREY, Busy: GREY, Full: GREY },
}

const KESTREL_SKIN: Skin = {
  ...TALLY_SKIN,
  bar: SLATE,
  barInk: "#ffffff",
  barMuted: "rgba(255,255,255,0.55)",
  barLine: SLATE,
  tabOn: "rgba(228,87,46,0.18)",
  tabOnInk: "#ff8a62",
  field: "rgba(255,255,255,0.14)",
  accent: ORANGE,
  soft: "#f9d9cd",
  hover: "#fdf1ec",
  title: "Gyms",
  sub: "6 gyms · Oregon & Washington · Saturday, Oct 17",
  cta: "Add gym",
  cols: ["Gym", "City", "Members", "Check-ins today", "On the wall", "Status"],
  kpis: ["Check-ins today", "Members", "Staff on the floor"],
  status: { Open: GREY, Quiet: ["#eef0f2", "#5b6470"], Steady: ["#e5f4ea", "#1f7a46"], Busy: ["#fdeae2", "#c2410c"], Full: ["#fde4e4", "#c42b2b"] },
}

/* ── Tally · Locations ───────────────────────────────────────────────── */

export const DASH_W = 796
export const DASH_H = 410
const BAR_H = 48
const TABLE_Y = 192
const HEAD_H = 30
const ROW_H = 34
const COLS_W = [176, 124, 96, 118, 150]
const DRAWER_W = 300

/** Where the brand mark sits in the nav (centre), and its size. */
export const DASH_MARK_AT: [number, number] = [28, BAR_H / 2]
export const DASH_MARK_SIZE = 24
/** A row's name cell, in screen px. */
export const DASH_ROW_AT = (i: number): [number, number] => [70, TABLE_Y + HEAD_H + ROW_H * i + ROW_H / 2]

type DashProps = {
  /** The brand in the nav: Tally's, or Kestrel's once it has landed. */
  branded?: boolean
  /** Colour sweep, 0 (Tally) → 1 (Kestrel). */
  sweep?: number
  /** Rows and numbers swapping to Kestrel's, 0 → 1. */
  fill?: number
  /** The row under the pointer, the row that's open (-1 for none). */
  hover?: number
  open?: number
  /** Drawer slide 0 → 1, its chart's growth 0 → 1, the bar under the pointer. */
  drawer?: number
  grow?: number
  bar?: number
}

/** Tally's Locations screen, mid re-skin: Tally under, Kestrel over, cut by a slanted sweep. */
export function TallyLocations(props: DashProps) {
  const { sweep = 0 } = props
  const SLANT = 140
  const x = sweep * (DASH_W + SLANT) - SLANT
  return (
    <div className="relative overflow-hidden" style={{ width: DASH_W, height: DASH_H }}>
      {sweep < 1 && <Screen skin={TALLY_SKIN} {...props} />}
      {sweep > 0 && (
        <div className="absolute inset-0" style={{ clipPath: `polygon(0 0, ${x + SLANT}px 0, ${x}px 100%, 0 100%)` }}>
          <Screen skin={KESTREL_SKIN} {...props} />
        </div>
      )}
    </div>
  )
}

function Screen({ skin: s, branded = false, fill = 0, hover = -1, open = -1, drawer = 0, grow = 0, bar = -1 }: DashProps & { skin: Skin }) {
  const kp = c01(fill * 1.15)
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#f6f6f8] font-sans text-[#16161f]">
      {/* Nav */}
      <div className="absolute inset-x-0 top-0 flex items-center border-b px-4" style={{ height: BAR_H, background: s.bar, borderColor: s.barLine, color: s.barInk }}>
        <span key={branded ? "k" : "t"} className={cn("flex items-center gap-2", branded && "km-land")}>
          {branded ? <KestrelMark size={DASH_MARK_SIZE} /> : s.mark}
          <span className="text-[14px] font-semibold tracking-[-0.01em] whitespace-nowrap">{branded ? "Kestrel Climbing" : s.brand}</span>
        </span>
        <div className="absolute left-[196px] flex gap-1 text-[12.5px] font-medium">
          {["Overview", s.title, "Staffing", "Reports"].map((t, i) => (
            <span key={i} className="rounded-[7px] px-2.5 py-1.5" style={i === 1 ? { background: s.tabOn, color: s.tabOnInk } : { color: s.barMuted }}>
              {t}
            </span>
          ))}
        </div>
        <span className="ml-auto flex h-[30px] w-[150px] items-center gap-2 rounded-[8px] border px-2.5 text-[12px]" style={{ borderColor: s.field, color: s.barMuted }}>
          <Search className="size-3.5" />
          Search
        </span>
        <span className="ml-2.5 grid size-[30px] place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: s.accent }}>
          DR
        </span>
      </div>

      {/* Title */}
      <div className="absolute inset-x-5 top-[62px] flex items-center justify-between">
        <div>
          <div className="text-[21px] leading-none font-semibold tracking-[-0.02em]">{s.title}</div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-[#787889]">
            <CalendarDays className="size-3.5" />
            {s.sub}
          </div>
        </div>
        <span className="flex items-center gap-1.5 rounded-[8px] px-3 py-[7px] text-[12.5px] font-semibold text-white" style={{ background: s.accent }}>
          <Plus className="size-3.5" strokeWidth={2.5} />
          {s.cta}
        </span>
      </div>

      {/* KPIs */}
      <div className="absolute inset-x-5 top-[116px] grid grid-cols-3 gap-3">
        {s.kpis.map((label, i) => (
          <div key={i} className="h-[62px] rounded-[10px] border border-[#ebebf0] bg-white px-3.5 py-2.5">
            <div className="text-[11.5px] text-[#787889]">{label}</div>
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-[21px] font-semibold tracking-[-0.03em] tabular-nums">
                {i < 2 ? num(mix(KPI_FROM[i], KPI_TO[i], kp)) : `${Math.round(mix(KPI_FROM[2], KPI_TO[2], kp))} of ${Math.round(mix(KPI_FROM[3], KPI_TO[3], kp))}`}
              </span>
              <span className="text-[11.5px] font-semibold whitespace-nowrap" style={{ color: s.accent }}>
                {kp < 0.5 ? DELTA_FROM[i] : DELTA_TO[i]}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="absolute inset-x-5 bottom-0 overflow-hidden rounded-t-[10px] border border-b-0 border-[#ebebf0] bg-white" style={{ top: TABLE_Y, maskImage: "linear-gradient(to bottom, black 82%, transparent)" }}>
        <div className="flex items-center border-b border-[#ebebf0] bg-[#fafafb] px-4 text-[11px] font-semibold tracking-[0.02em] text-[#8a8a9a]" style={{ height: HEAD_H }}>
          {s.cols.map((c, i) => (
            <span key={i} className={cn("shrink-0", (i === 2 || i === 3) && "pr-5 text-right")} style={{ width: COLS_W[i] }}>
              {c}
            </span>
          ))}
        </div>
        {GYMS.map((g, i) => {
          const p = rowP(fill, i)
          const out = c01(p * 2)
          const inn = c01(p * 2 - 1)
          const lit = hover === i || open === i
          return (
            <div key={i} className="relative border-b border-[#f1f1f5]" style={{ height: ROW_H }}>
              <div className="absolute inset-0 transition-colors duration-150" style={{ background: lit ? s.hover : "transparent" }} />
              <div className="absolute inset-0" style={{ background: s.soft, opacity: Math.sin(Math.PI * p) * 0.55 }} />
              {open === i && <div className="absolute inset-y-0 left-0 w-[2.5px]" style={{ background: s.accent }} />}
              {out < 1 && <SiteRow r={SEED[i]} skin={s} wall={mix(SEED[i].wall, g.wall, p)} style={{ opacity: 1 - out, transform: `translateY(${-7 * out}px)` }} />}
              {inn > 0 && <SiteRow r={g} skin={s} wall={mix(SEED[i].wall, g.wall, p)} style={{ opacity: inn, transform: `translateY(${7 * (1 - inn)}px)` }} />}
            </div>
          )
        })}
      </div>

      {/* Detail drawer */}
      {drawer > 0 && open >= 0 && <Drawer g={GYMS[open]} skin={s} slide={drawer} grow={grow} bar={bar} />}
      <style>{`@keyframes km-land { 0% { opacity: 0; transform: scale(.6) } 60% { opacity: 1 } } .km-land { animation: km-land .4s cubic-bezier(.34,1.56,.64,1) both; transform-origin: 12px 50% }`}</style>
    </div>
  )
}

function SiteRow({ r, skin: s, wall, style }: { r: Site; skin: Skin; wall: number; style: CSSProperties }) {
  const [bg, ink] = s.status[r.status]
  return (
    <div className="absolute inset-0 flex items-center px-4 text-[12.5px]" style={style}>
      <span className="shrink-0 truncate font-semibold" style={{ width: COLS_W[0] }}>
        {r.name}
      </span>
      <span className="shrink-0 text-[#787889]" style={{ width: COLS_W[1] }}>
        {r.city}
      </span>
      <span className="shrink-0 pr-5 text-right tabular-nums" style={{ width: COLS_W[2] }}>
        {num(r.members)}
      </span>
      <span className="shrink-0 pr-5 text-right font-medium tabular-nums" style={{ width: COLS_W[3] }}>
        {num(r.today)}
      </span>
      <span className="flex shrink-0 items-center gap-2" style={{ width: COLS_W[4] }}>
        <span className="h-[5px] w-[84px] overflow-hidden rounded-full bg-[#ededf2]">
          <span className="block h-full rounded-full" style={{ width: `${wall * 100}%`, background: s.accent }} />
        </span>
        <span className="text-[11.5px] text-[#787889] tabular-nums">{Math.round(wall * 100)}%</span>
      </span>
      <span className="rounded-full px-2 py-[2px] text-[11px] font-semibold" style={{ background: bg, color: ink }}>
        {r.status}
      </span>
    </div>
  )
}

/* ── A gym's detail ──────────────────────────────────────────────────── */

const HOURS = ["10a", "11a", "12p", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p"]
/** The Foundry's check-ins by hour today (they add up to 412). */
const BY_HOUR = [14, 19, 24, 27, 24, 30, 41, 52, 58, 55, 44, 24]
const STAFF = [
  { who: "Maya Okafor", role: "Route setter", until: "until 6p", tint: "#f2b8a4" },
  { who: "Jonah Reyes", role: "Front desk", until: "until 9p", tint: "#b9cbe0" },
]
const CHART = { x: 16, y: 180, w: DRAWER_W - 32, h: 80 }
/** The tallest bar leaves room above it for the hover label. */
const TALL = CHART.h - 26
const BAR_GAP = 4
const BAR_W = (CHART.w - BAR_GAP * (HOURS.length - 1)) / HOURS.length
/** The peak hour's bar (6p) */
export const PEAK = BY_HOUR.indexOf(Math.max(...BY_HOUR))
/** Top-centre-ish of an hour's bar, in screen px (with the drawer open). */
export const DASH_BAR_AT = (i: number): [number, number] => [DASH_W - DRAWER_W + CHART.x + i * (BAR_W + BAR_GAP) + BAR_W / 2, BAR_H + CHART.y + CHART.h - (BY_HOUR[i] / Math.max(...BY_HOUR)) * TALL * 0.6]

function Drawer({ g, skin: s, slide, grow, bar }: { g: Site; skin: Skin; slide: number; grow: number; bar: number }) {
  const [bg, ink] = s.status[g.status]
  const max = Math.max(...BY_HOUR)
  return (
    <>
      <div className="absolute inset-x-0 bottom-0 bg-[#16161f]" style={{ top: BAR_H, opacity: slide * 0.08 }} />
      <div
        className="absolute right-0 bottom-0 border-l border-[#ebebf0] bg-white shadow-[-12px_0_32px_-12px_rgba(22,22,31,0.18)]"
        style={{ top: BAR_H, width: DRAWER_W, transform: `translateX(${(1 - slide) * (DRAWER_W + 24)}px)` }}
      >
        <div className="flex items-start justify-between px-4 pt-3.5">
          <div>
            <div className="text-[16px] leading-tight font-semibold tracking-[-0.01em]">{g.name}</div>
            <div className="mt-1 text-[11.5px] text-[#787889]">1410 NW Raleigh St · {g.city}</div>
          </div>
          <X className="mt-0.5 size-4 text-[#9a9aab]" />
        </div>
        <div className="mt-2.5 flex items-center gap-2 px-4 text-[11.5px] text-[#787889]">
          <span className="rounded-full px-2 py-[2px] font-semibold" style={{ background: bg, color: ink }}>
            {g.status}
          </span>
          {Math.round(g.wall * 100)}% on the wall right now
        </div>
        <div className="mx-4 mt-3 grid grid-cols-2 gap-2">
          {[
            ["Check-ins today", num(g.today)],
            ["Members", num(g.members)],
          ].map(([l, v]) => (
            <div key={l} className="rounded-[8px] bg-[#f6f6f8] px-2.5 py-1.5">
              <div className="text-[10.5px] text-[#787889]">{l}</div>
              <div className="text-[17px] font-semibold tracking-[-0.02em] tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <div className="absolute inset-x-4 flex justify-between text-[12px] font-semibold" style={{ top: CHART.y - 24 }}>
          Check-ins by hour
          <span className="text-[11px] font-medium text-[#9a9aab]">Today</span>
        </div>
        <div className="absolute" style={{ left: CHART.x, top: CHART.y, width: CHART.w, height: CHART.h }}>
          {BY_HOUR.map((v, i) => {
            const h = (v / max) * TALL * c01(grow * 1.6 - i * 0.05)
            return (
              <div key={i} className="absolute bottom-0 rounded-t-[3px] transition-colors duration-150" style={{ left: i * (BAR_W + BAR_GAP), width: BAR_W, height: h, background: i === bar || (bar < 0 && i === PEAK) ? s.accent : s.soft }} />
            )
          })}
          {bar >= 0 && (
            <div className="km-pop absolute -translate-x-1/2 rounded-[6px] bg-[#16161f] px-2 py-1 text-[10.5px] font-medium whitespace-nowrap text-white" style={{ left: bar * (BAR_W + BAR_GAP) + BAR_W / 2, bottom: (BY_HOUR[bar] / max) * TALL + 6 }}>
              {HOURS[bar]} · {BY_HOUR[bar]} check-ins
            </div>
          )}
        </div>
        <div className="absolute flex text-[10px] text-[#9a9aab]" style={{ left: CHART.x, top: CHART.y + CHART.h + 4, width: CHART.w }}>
          {HOURS.map((h, i) => (
            <span key={h} className="text-center" style={{ width: BAR_W, marginLeft: i ? BAR_GAP : 0, opacity: i % 3 === 0 ? 1 : 0 }}>
              {h}
            </span>
          ))}
        </div>
        <div className="absolute inset-x-4" style={{ top: CHART.y + CHART.h + 22 }}>
          <div className="text-[12px] font-semibold">On the floor · 9 staff</div>
          {STAFF.map((p) => (
            <div key={p.who} className="mt-1.5 flex items-center gap-2 text-[11.5px]">
              <span className="grid size-[22px] place-items-center rounded-full text-[9.5px] font-semibold text-[#16161f]/70" style={{ background: p.tint }}>
                {p.who
                  .split(" ")
                  .map((w) => w[0])
                  .join("")}
              </span>
              <span className="font-medium">{p.who}</span>
              <span className="text-[#787889]">{p.role}</span>
              <span className="ml-auto text-[#9a9aab]">{p.until}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
