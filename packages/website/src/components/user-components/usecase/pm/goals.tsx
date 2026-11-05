/**
 * "Savings goals" in the sprout fintech brand (motion/mvf/fintech.tsx
 * palette): a small component kit standing in for the team's
 * src/components/ui (SpButton, SpCard, SpProgress, SpChip, SpRow, SpField),
 * its sticker sheet (SproutUI), three takes on one PRD built only from it
 * (GoalsList, GoalsFocus, GoalsStart), and the PRD page itself (GoalsPrd,
 * story-specific: Antidraw has no doc view).
 *
 * Frames are 300×600. Everything a scene clicks sits at a fixed position,
 * exported as FOCUS_* / START_* points in frame coordinates.
 */
import type { ReactNode } from "react"
import { Check, Home, Laptop, PiggyBank, Plane, Plus, Send, Umbrella, User } from "lucide-react"

import { cn } from "@/lib/utils"
import { DEEP, LIME, PALE } from "../../motion/mvf/fintech"

export const GOAL_W = 300
export const GOAL_H = 600

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`

/* ── The kit ("src/components/ui") ──────────────────────────────────────── */

export function SpButton({ children, icon, variant = "primary", className }: { children: ReactNode; icon?: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <span
      className={cn("flex h-11 items-center justify-center gap-1.5 rounded-[12px] text-[13.5px] font-semibold", className)}
      style={variant === "primary" ? { background: DEEP, color: LIME } : { background: "#fff", color: DEEP, boxShadow: `inset 0 0 0 1.5px ${DEEP}` }}
    >
      {icon}
      {children}
    </span>
  )
}

export function SpCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[16px] bg-white p-3.5 shadow-[0_6px_18px_rgba(13,74,18,0.08)]", className)}>{children}</div>
}

export function SpProgress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-[7px] overflow-hidden rounded-full", className)} style={{ background: "rgba(13,74,18,0.10)" }}>
      <div className="h-full rounded-full" style={{ width: `${value * 100}%`, background: DEEP }} />
    </div>
  )
}

export function SpChip({ children, selected, className }: { children: ReactNode; selected?: boolean; className?: string }) {
  return (
    <span
      className={cn("flex h-[34px] items-center justify-center rounded-full px-3 text-[13px] font-semibold tabular-nums transition-colors duration-200", className)}
      style={selected ? { background: DEEP, color: LIME } : { background: "#fff", color: DEEP, boxShadow: "inset 0 0 0 1px rgba(13,74,18,0.14)" }}
    >
      {children}
    </span>
  )
}

const ICONS = { trip: Plane, laptop: Laptop, home: Home, rainy: Umbrella }
type IconKey = keyof typeof ICONS
const TILE: Record<IconKey, string> = { trip: "#4cc3ff", laptop: "#ff4fd8", home: "#ffb020", rainy: "#3ddc4a" }

export function SpIcon({ icon, size = 38 }: { icon: IconKey; size?: number }) {
  const I = ICONS[icon]
  return (
    <span className="grid shrink-0 place-items-center rounded-[10px]" style={{ width: size, height: size, background: TILE[icon] }}>
      <I size={size * 0.45} color="#fff" strokeWidth={2.2} />
    </span>
  )
}

export function SpRow({ icon, title, sub, right }: { icon: IconKey; title: string; sub: string; right?: string }) {
  return (
    <div className="flex h-[52px] items-center gap-3 rounded-[12px] bg-white px-3">
      <SpIcon icon={icon} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{title}</div>
        <div className="text-[11px] opacity-55">{sub}</div>
      </div>
      {right && <span className="text-[12px] font-semibold tabular-nums opacity-70">{right}</span>}
    </div>
  )
}

export function SpField({ value, hint, className }: { value: string; hint?: string; className?: string }) {
  return (
    <div className={cn("flex h-[52px] items-center justify-between rounded-[12px] bg-white px-4", className)} style={{ boxShadow: "inset 0 0 0 1px rgba(13,74,18,0.14)" }}>
      <span className="text-[20px] font-black tracking-[-0.02em] tabular-nums">{value}</span>
      {hint && <span className="text-[11.5px] font-medium opacity-55">{hint}</span>}
    </div>
  )
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 overflow-hidden font-sans" style={{ background: PALE, color: DEEP }}>
      <div className="flex justify-between px-5 pt-2.5 text-[11px] font-semibold">
        <span>9:41</span>
        <span>●●● ▮</span>
      </div>
      {children}
    </div>
  )
}

function Nav() {
  return (
    <div className="absolute inset-x-5 bottom-3 flex items-center justify-around rounded-full py-2 shadow-[0_6px_20px_rgba(0,0,0,0.10)]" style={{ background: DEEP, color: LIME }}>
      <Home size={14} />
      <span className="grid size-7 place-items-center rounded-full" style={{ background: LIME, color: DEEP }}>
        <PiggyBank size={14} />
      </span>
      <Send size={14} />
      <User size={14} />
    </div>
  )
}

/** The kit's pieces, one rendered example each (trays, sheets, flying copies). */
export const KIT: { name: string; el: ReactNode }[] = [
  { name: "SpButton", el: <SpButton className="w-[140px]">Primary</SpButton> },
  { name: "SpChip", el: <SpChip className="w-[76px]">+$50</SpChip> },
  { name: "SpProgress", el: <SpProgress value={0.62} className="w-[140px]" /> },
  {
    name: "SpCard",
    el: (
      <SpCard className="w-[140px] !p-2.5">
        <div className="text-[12px] font-semibold">Card</div>
        <div className="text-[10.5px] opacity-60">Supporting text</div>
      </SpCard>
    ),
  },
  {
    name: "SpRow",
    el: (
      <div className="w-[150px]">
        <SpRow icon="rainy" title="Row" sub="Detail" />
      </div>
    ),
  },
  { name: "SpField", el: <SpField value="$2,000" className="w-[140px]" /> },
]

/* ── The sticker sheet ──────────────────────────────────────────────────── */

const Label = ({ children }: { children: ReactNode }) => <div className="mb-1.5 font-mono text-[10px] font-medium opacity-45">{children}</div>

/** The team's components, as a frame on the canvas. */
export function SproutUI() {
  return (
    <div className="absolute inset-0 overflow-hidden px-5 pt-5 font-sans" style={{ background: PALE, color: DEEP }}>
      <div className="text-[18px] font-black tracking-[-0.02em]">Sprout UI</div>
      <div className="mt-0.5 font-mono text-[10.5px] opacity-50">src/components/ui</div>
      <div className="mt-4 flex flex-col gap-3.5">
        <div>
          <Label>{"<SpButton>"}</Label>
          <div className="flex gap-2">
            <SpButton className="flex-1">Primary</SpButton>
            <SpButton className="flex-1" variant="secondary">
              Secondary
            </SpButton>
          </div>
        </div>
        <div>
          <Label>{"<SpChip>"}</Label>
          <div className="flex gap-2">
            <SpChip selected>+$50</SpChip>
            <SpChip>+$100</SpChip>
            <SpChip>Weekly</SpChip>
          </div>
        </div>
        <div>
          <Label>{"<SpProgress>"}</Label>
          <SpProgress value={0.62} />
        </div>
        <div>
          <Label>{"<SpCard>"}</Label>
          <SpCard className="!p-3">
            <div className="text-[13px] font-semibold">Card title</div>
            <div className="mt-0.5 text-[11.5px] opacity-60">Supporting text sits here.</div>
          </SpCard>
        </div>
        <div>
          <Label>{"<SpRow>"}</Label>
          <SpRow icon="rainy" title="Row title" sub="Detail" right="$800" />
        </div>
        <div>
          <Label>{"<SpField>"}</Label>
          <SpField value="$2,000" hint="Hint" />
        </div>
      </div>
    </div>
  )
}

/* ── Take 1: every goal in view ─────────────────────────────────────────── */

const GOALS: { icon: IconKey; name: string; saved: number; target: number }[] = [
  { icon: "trip", name: "Japan trip", saved: 1240, target: 2000 },
  { icon: "laptop", name: "New laptop", saved: 1100, target: 1300 },
  { icon: "rainy", name: "Rainy day", saved: 800, target: 2000 },
]

export function GoalsList() {
  return (
    <Screen>
      <div className="absolute inset-x-5 top-[44px]">
        <div className="text-[12px] font-medium opacity-60">Savings goals</div>
        <div className="mt-0.5 text-[26px] leading-[1.1] font-black tracking-[-0.03em]">$3,140 saved</div>
      </div>
      <div className="absolute inset-x-5 top-[116px] flex flex-col gap-3">
        {GOALS.map((g) => (
          <SpCard key={g.name}>
            <div className="flex items-center gap-3">
              <SpIcon icon={g.icon} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">{g.name}</div>
                <div className="text-[11.5px] tabular-nums opacity-55">
                  {money(g.saved)} of {money(g.target)}
                </div>
              </div>
              <span className="text-[13px] font-bold tabular-nums">{Math.round((g.saved / g.target) * 100)}%</span>
            </div>
            <SpProgress value={g.saved / g.target} className="mt-3" />
          </SpCard>
        ))}
      </div>
      <SpButton className="absolute inset-x-5 top-[468px]" icon={<Plus size={15} />}>
        New goal
      </SpButton>
      <Nav />
    </Screen>
  )
}

/* ── Take 2: one goal first, one-tap top-ups ────────────────────────────── */

export const FOCUS_CHIPS = ["+$50", "+$100", "+$250"]
/** Centres of the top-up chips and the Add money button, in frame px. */
export const FOCUS_CHIP_AT = (i: number): [number, number] => [66 + i * 84, 337]
export const FOCUS_ADD_AT: [number, number] = [150, 390]

/** `added` 0→250 tweens the saved amount and the ring; `chip` is the picked top-up (-1 none). */
export function GoalsFocus({ added = 0, chip = -1 }: { added?: number; chip?: number }) {
  const saved = 1240 + added
  const p = saved / 2000
  const R = 66
  const C = 2 * Math.PI * R
  return (
    <Screen>
      <div className="absolute inset-x-5 top-[44px] flex items-start justify-between">
        <div>
          <div className="text-[12px] font-medium opacity-60">Saving for</div>
          <div className="mt-0.5 text-[26px] leading-[1.1] font-black tracking-[-0.03em]">Japan trip</div>
        </div>
        <SpIcon icon="trip" size={36} />
      </div>
      <div className="absolute top-[118px] left-1/2 -translate-x-1/2" style={{ width: 2 * R + 16, height: 2 * R + 16 }}>
        <svg width={2 * R + 16} height={2 * R + 16} className="-rotate-90">
          <circle cx={R + 8} cy={R + 8} r={R} fill="none" stroke="rgba(13,74,18,0.10)" strokeWidth={13} />
          <circle cx={R + 8} cy={R + 8} r={R} fill="none" stroke={DEEP} strokeWidth={13} strokeLinecap="round" strokeDasharray={`${C * p} ${C}`} />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <div className="text-[25px] leading-none font-black tracking-[-0.03em] tabular-nums">{money(saved)}</div>
          <div className="mt-1 text-[11.5px] font-medium opacity-55">of $2,000 · {Math.round(p * 100)}%</div>
        </div>
      </div>
      <div className="absolute top-[278px] inset-x-0 text-center text-[11.5px] font-medium opacity-55">On track for March</div>
      <div className="absolute top-[320px] left-[28px] flex gap-2">
        {FOCUS_CHIPS.map((c, i) => (
          <SpChip key={c} selected={chip === i} className="w-[76px]">
            {c}
          </SpChip>
        ))}
      </div>
      <SpButton className="absolute top-[368px] inset-x-6">Add money</SpButton>
      <div className="absolute inset-x-5 top-[432px]">
        <div className="mb-2 text-[12px] font-semibold opacity-60">Other goals</div>
        <div className="flex flex-col gap-2">
          <SpRow icon="laptop" title="New laptop" sub="by December" right="85%" />
          <SpRow icon="rainy" title="Rainy day" sub="by June" right="40%" />
        </div>
      </div>
    </Screen>
  )
}

/* ── Take 3: start by setting one up ────────────────────────────────────── */

const KINDS: { icon: IconKey; name: string }[] = [
  { icon: "trip", name: "A trip" },
  { icon: "laptop", name: "Something big" },
  { icon: "home", name: "A home" },
  { icon: "rainy", name: "Rainy day" },
]
/** Centre of each kind tile, in frame px. */
export const START_TILE_AT = (i: number): [number, number] => [84 + (i % 2) * 132, 222 + Math.floor(i / 2) * 104]

/** `pick` is the chosen kind (-1 none); once picked, Continue wakes up. */
export function GoalsStart({ pick = -1 }: { pick?: number }) {
  return (
    <Screen>
      <div className="absolute inset-x-6 top-[44px]">
        <div className="text-[11.5px] font-semibold opacity-55">Step 1 of 3</div>
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1 flex-1 rounded-full" style={{ background: i === 0 ? DEEP : "rgba(13,74,18,0.12)" }} />
          ))}
        </div>
        <div className="mt-4 text-[23px] leading-[1.15] font-black tracking-[-0.03em]">What are you saving for?</div>
      </div>
      <div className="absolute top-[176px] left-6 grid grid-cols-2 gap-3">
        {KINDS.map((k, i) => (
          <div
            key={k.name}
            className="flex h-[92px] w-[120px] flex-col justify-between rounded-[16px] p-3 transition-colors duration-200"
            style={pick === i ? { background: DEEP, color: LIME } : { background: "#fff", boxShadow: "0 6px 18px rgba(13,74,18,0.08)" }}
          >
            <SpIcon icon={k.icon} size={30} />
            <span className="text-[13px] font-semibold">{k.name}</span>
          </div>
        ))}
      </div>
      <div className="absolute inset-x-6 top-[392px]">
        <div className="mb-2 text-[12px] font-semibold opacity-60">Target</div>
        <SpField value="$2,000" hint="by March" />
      </div>
      <SpButton className={cn("absolute inset-x-6 top-[520px] transition-opacity duration-200", pick < 0 && "opacity-35")}>Continue</SpButton>
    </Screen>
  )
}

/* ── The PRD ────────────────────────────────────────────────────────────── */

export const PRD_W = 300
export const PRD_H = 380

const INK = "#37352f"
const GREY = "#787774"

/**
 * A doc page the way a team's wiki shows one (Notion-ish: breadcrumb, page
 * icon, properties, plain headings, to-dos). `checked[i]` ticks requirement i.
 */
export function GoalsPrd({ className, checked = [] }: { className?: string; checked?: boolean[] }) {
  const Prop = ({ k, children }: { k: string; children: ReactNode }) => (
    <div className="flex h-[22px] items-center text-[11px]">
      <span className="w-[64px] shrink-0" style={{ color: GREY }}>
        {k}
      </span>
      {children}
    </div>
  )
  const H3 = ({ children }: { children: ReactNode }) => <div className="mt-2.5 text-[13px] font-semibold">{children}</div>
  return (
    <div className={cn("relative flex flex-col overflow-hidden rounded-[6px] bg-white px-6 pt-4 font-sans shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)]", className)} style={{ width: PRD_W, height: PRD_H, color: INK }}>
      <div className="text-[10px]" style={{ color: GREY }}>
        Product <span className="opacity-50">/</span> Specs <span className="opacity-50">/</span> Savings goals
      </div>
      <div className="mt-2.5 text-[22px] leading-none">🎯</div>
      <div className="mt-1.5 text-[20px] leading-tight font-bold tracking-[-0.01em]">Savings goals</div>
      <div className="mt-1.5 border-b border-black/[0.08] pb-1.5">
        <Prop k="Owner">
          <span className="mr-1.5 grid size-4 place-items-center rounded-full bg-[#e9e5e3] text-[8.5px] font-semibold">P</span>
          Priya Shah
        </Prop>
        <Prop k="Status">
          <span className="rounded-[3px] bg-[#fdecc8] px-1.5 text-[10.5px] leading-[17px] text-[#402c1b]">Draft</span>
        </Prop>
        <Prop k="Release">Q3</Prop>
      </div>
      <H3>Problem</H3>
      <p className="m-0 mt-0.5 text-[11.5px] leading-[1.55]">Customers save, but not toward anything, so they stop adding.</p>
      <H3>Requirements</H3>
      <div className="mt-1 flex flex-col gap-[3px] text-[11.5px] leading-[1.45]">
        {["Set a goal: a name, an amount, a date", "See how close you are at a glance", "Add money to a goal in one tap"].map((s, i) => (
          <div key={s} className="flex items-start gap-2">
            <span
              className={cn("mt-[3px] grid size-[11px] shrink-0 place-items-center rounded-[2px] transition-colors duration-200", checked[i] ? "bg-[#2383e2] text-white" : "")}
              style={checked[i] ? undefined : { boxShadow: `inset 0 0 0 1.3px ${INK}` }}
            >
              {checked[i] && <Check size={9} strokeWidth={3.5} />}
            </span>
            <span className="transition-colors duration-200" style={checked[i] ? { color: GREY } : undefined}>
              {s}
            </span>
          </div>
        ))}
      </div>
      <H3>Not in v1</H3>
      <p className="m-0 mt-0.5 text-[11.5px] leading-[1.55]">Shared goals, round-ups into a goal.</p>
    </div>
  )
}
