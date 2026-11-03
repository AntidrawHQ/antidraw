/**
 * The thing being sold in the sales scenes: "Tally", a made-up sales & staffing
 * dashboard for multi-location businesses, as one themeable screen (natural
 * size 960×600). The prospect is "Larkspur Coffee" (made up too), whose brand
 * Claude pulls from larkspur.coffee and pours into the same screen.
 */
import type { ReactNode } from "react"
import { BarChart3, CalendarDays, ClipboardList, LayoutGrid, MapPin, Plus, Users } from "lucide-react"

import { cn } from "@/lib/utils"

export type DemoTheme = {
  brand: string
  logo: ReactNode
  page: string
  side: string
  sideLine: string
  sideInk: string
  sideMuted: string
  sideActive: string
  ink: string
  muted: string
  card: string
  line: string
  accent: string
  accentInk: string
  accentSoft: string
  display: string
  greeting: string
  sub: string
  kpis: { label: string; value: string; delta: string }[]
  bars: number[]
  locations: { name: string; value: string; share: number }[]
  cta?: string
  chartTitle?: string
  chartRange?: string
  barLabels?: string[]
}

/* ── Logos ───────────────────────────────────────────────────────────── */

export function TallyMark({ size = 26 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[7px] bg-[#4f46e5] text-white" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
        <path d="M6 5v14M10.5 5v14M15 5v14M19 7 4 17" />
      </svg>
    </span>
  )
}

/** Larkspur's mark: a copper sprig in a forest roundel. */
export function LarkspurMark({ size = 26, ring = "#f4ede1" }: { size?: number; ring?: string }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className="shrink-0" aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill="#c4683a" />
      <circle cx="20" cy="20" r="15.5" fill="none" stroke={ring} strokeOpacity=".55" strokeWidth="1" />
      <path d="M20 31V12" stroke={ring} strokeWidth="1.8" strokeLinecap="round" />
      {[14, 18.5, 23].map((y, i) => (
        <g key={y} fill={ring}>
          <ellipse cx={15.6 + i * 0.6} cy={y} rx="3.8" ry="1.9" transform={`rotate(-32 ${15.6 + i * 0.6} ${y})`} />
          <ellipse cx={24.4 - i * 0.6} cy={y + 1.6} rx="3.8" ry="1.9" transform={`rotate(32 ${24.4 - i * 0.6} ${y + 1.6})`} />
        </g>
      ))}
      <circle cx="20" cy="10.5" r="2" fill={ring} />
    </svg>
  )
}

/* ── Themes ──────────────────────────────────────────────────────────── */

export const TALLY: DemoTheme = {
  brand: "Tally",
  logo: <TallyMark />,
  page: "#f6f6f8",
  side: "#ffffff",
  sideLine: "#e8e8ee",
  sideInk: "#1d1d27",
  sideMuted: "#7a7a8c",
  sideActive: "#eeedfd",
  ink: "#16161f",
  muted: "#787889",
  card: "#ffffff",
  line: "#ebebf0",
  accent: "#4f46e5",
  accentInk: "#ffffff",
  accentSoft: "#e0defc",
  display: "ui-sans-serif, system-ui, sans-serif",
  greeting: "Good morning, Acme",
  sub: "Saturday, Oct 17 · 5 stores",
  kpis: [
    { label: "Sales today", value: "$12,480", delta: "+4.1%" },
    { label: "Orders", value: "1,036", delta: "+2.7%" },
    { label: "Staff on shift", value: "18", delta: "of 22" },
  ],
  bars: [0.22, 0.35, 0.58, 0.8, 0.66, 0.52, 0.71, 0.9, 0.62, 0.44, 0.3, 0.2],
  locations: [
    { name: "Store 01", value: "$4,210", share: 0.86 },
    { name: "Store 02", value: "$3,380", share: 0.7 },
    { name: "Store 03", value: "$2,940", share: 0.6 },
    { name: "Store 04", value: "$1,950", share: 0.42 },
    { name: "Store 05", value: "$1,610", share: 0.36 },
  ],
}

export const LARKSPUR: DemoTheme = {
  brand: "Larkspur",
  logo: <LarkspurMark ring="#f4ede1" />,
  page: "#f4ede1",
  side: "#1f3b2f",
  sideLine: "#2c4b3d",
  sideInk: "#f4ede1",
  sideMuted: "#a9bba9",
  sideActive: "#2d5040",
  ink: "#1f2a22",
  muted: "#7a7262",
  card: "#fffaf1",
  line: "#e8dcc6",
  accent: "#c4683a",
  accentInk: "#fffaf1",
  accentSoft: "#f0d3bd",
  display: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  greeting: "Good morning, Larkspur",
  sub: "Saturday, Oct 17 · 14 cafés",
  kpis: [
    { label: "Sales today", value: "$48,210", delta: "+8.2%" },
    { label: "Cups poured", value: "9,412", delta: "+5.6%" },
    { label: "Baristas on shift", value: "61", delta: "of 66" },
  ],
  bars: [0.62, 0.95, 0.88, 0.7, 0.55, 0.6, 0.66, 0.5, 0.42, 0.36, 0.3, 0.22],
  locations: [
    { name: "Pearl Street", value: "$6,820", share: 0.9 },
    { name: "Riverside", value: "$5,940", share: 0.78 },
    { name: "Old Mill", value: "$5,310", share: 0.7 },
    { name: "Union Square", value: "$4,760", share: 0.62 },
    { name: "Harbor Row", value: "$4,180", share: 0.55 },
  ],
}

/* ── The screen ──────────────────────────────────────────────────────── */

const NAV = [
  { icon: LayoutGrid, label: "Overview" },
  { icon: MapPin, label: "Locations" },
  { icon: Users, label: "Staffing" },
  { icon: ClipboardList, label: "Orders" },
  { icon: BarChart3, label: "Reports" },
]

const HOURS = ["6a", "7a", "8a", "9a", "10a", "11a", "12p", "1p", "2p", "3p", "4p", "5p"]

/** Tally's overview screen in a theme. Natural size 960×600. */
export function TallyDemo({ theme: th, className }: { theme: DemoTheme; className?: string }) {
  const peak = th.bars.indexOf(Math.max(...th.bars))
  return (
    <div className={cn("flex h-[600px] w-[960px] font-sans", className)} style={{ background: th.page, color: th.ink }}>
      <aside className="flex w-[200px] shrink-0 flex-col border-r px-4 py-5" style={{ background: th.side, borderColor: th.sideLine }}>
        <div className="flex items-center gap-2.5 px-1.5">
          {th.logo}
          <span className="text-[19px] font-semibold tracking-[-0.02em]" style={{ color: th.sideInk, fontFamily: th.display }}>
            {th.brand}
          </span>
        </div>
        <nav className="mt-7 flex flex-col gap-1">
          {NAV.map(({ icon: Icon, label }, i) => (
            <span
              key={label}
              className="flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[14px] font-medium"
              style={{ background: i === 0 ? th.sideActive : "transparent", color: i === 0 ? th.sideInk : th.sideMuted }}
            >
              <Icon className="size-[17px]" strokeWidth={2} style={{ color: i === 0 ? th.accent : undefined }} />
              {label}
            </span>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 px-1.5">
          <span className="size-8 rounded-full" style={{ background: th.accentSoft }} />
          <div className="leading-tight">
            <div className="text-[13px] font-medium" style={{ color: th.sideInk }}>
              Dana Ruiz
            </div>
            <div className="text-[12px]" style={{ color: th.sideMuted }}>
              Ops lead
            </div>
          </div>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col gap-5 px-8 py-7">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[30px] leading-none font-semibold tracking-[-0.025em]" style={{ fontFamily: th.display }}>
              {th.greeting}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[14px]" style={{ color: th.muted }}>
              <CalendarDays className="size-4" />
              {th.sub}
            </div>
          </div>
          <span className="flex items-center gap-1.5 rounded-[9px] px-3.5 py-2 text-[14px] font-semibold" style={{ background: th.accent, color: th.accentInk }}>
            <Plus className="size-4" strokeWidth={2.5} />
            {th.cta ?? "New report"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {th.kpis.map((k) => (
            <div key={k.label} className="rounded-[12px] border px-4 py-3.5" style={{ background: th.card, borderColor: th.line }}>
              <div className="text-[13px]" style={{ color: th.muted }}>
                {k.label}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-[26px] font-semibold tracking-[-0.03em] tabular-nums" style={{ fontFamily: th.display }}>
                  {k.value}
                </span>
                <span className="text-[13px] font-semibold" style={{ color: th.accent }}>
                  {k.delta}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 gap-4">
          <div className="flex flex-[1.35] flex-col rounded-[12px] border px-5 pt-4 pb-3" style={{ background: th.card, borderColor: th.line }}>
            <div className="flex items-center justify-between text-[14px] font-semibold">
              {th.chartTitle ?? "Sales by hour"}
              <span className="text-[12px] font-medium" style={{ color: th.muted }}>
                {th.chartRange ?? "Today"}
              </span>
            </div>
            <div className="mt-3 flex flex-1 items-end gap-2">
              {th.bars.map((b, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="w-full rounded-[5px]" style={{ height: `${b * 196}px`, background: i === peak ? th.accent : th.accentSoft }} />
                  <span className="text-[10px]" style={{ color: th.muted }}>
                    {(th.barLabels ?? HOURS)[i]}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-1 flex-col rounded-[12px] border px-5 py-4" style={{ background: th.card, borderColor: th.line }}>
            <div className="text-[14px] font-semibold">Top locations</div>
            <div className="mt-3 flex flex-col gap-3.5">
              {th.locations.map((l) => (
                <div key={l.name}>
                  <div className="flex justify-between text-[13px]">
                    <span className="font-medium">{l.name}</span>
                    <span className="tabular-nums" style={{ color: th.muted }}>
                      {l.value}
                    </span>
                  </div>
                  <div className="mt-1.5 h-[6px] rounded-full" style={{ background: th.line }}>
                    <div className="h-full rounded-full" style={{ width: `${l.share * 100}%`, background: th.accent }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

/* ── Larkspur's brand, as Claude pulled it ───────────────────────────── */

export const LARKSPUR_SWATCHES = [
  { name: "Forest", hex: "#1F3B2F" },
  { name: "Copper", hex: "#C4683A" },
  { name: "Cream", hex: "#F4EDE1" },
  { name: "Honey", hex: "#E9B872" },
]
