/**
 * "Design every state" pieces: MemberList, the members card from the
 * settings page of Whitlock (a made-up bills & approvals app), and the state
 * bar the agent adds on top of it.
 *
 *  - MemberList  the card: header, four member rows, footer. Every state is
 *                a prop so a timeline can cross between them: `layers` gives
 *                the opacity of the rows, the loading skeleton, the empty
 *                state and the error; `hover` 0→1 is the forced hover on
 *                Tomás's row; `long` 0→1 swaps the first row for a
 *                40-character name and a title that wraps to three lines.
 *  - StateBar    the segmented control: Default … Long text, then All states.
 *                `at` is a continuous pill index so the thumb can glide.
 *
 * MemberList is CARD_W×CARD_H; PILL_AT points are StateBar px.
 */
import type { ReactNode } from "react"
import { LayoutGrid, MoreHorizontal, Plus, RotateCw, TriangleAlert, Users } from "lucide-react"

import { cn } from "@/lib/utils"

const mix = (a: number, b: number, p: number) => a + (b - a) * p

/* ── Brand ──────────────────────────────────────────────────────────────── */

export const INK = "#1D1C1A"
export const PINE = "#2F5D50"
export const PAPER = "#F2F1EC"
const MUTED = "rgba(29,28,26,0.55)"
const LINE = "rgba(29,28,26,0.08)"

/* ── The data ───────────────────────────────────────────────────────────── */

type Member = { name: string; title: string; role: string; tone: [string, string] }
const MEMBERS: Member[] = [
  { name: "Priya Raman", title: "Head of Finance", role: "Admin", tone: ["#EBDDC8", "#6B4E2E"] },
  { name: "Tomás Ferreira", title: "Accounts payable lead", role: "Approver", tone: ["#D6E4DB", "#2F5D50"] },
  { name: "Hannah Okafor", title: "Financial controller", role: "Approver", tone: ["#E4DFD3", "#5B5240"] },
  { name: "Jun Watanabe", title: "Bookkeeper · contract", role: "Viewer", tone: ["#F0DAD2", "#8A3B2A"] },
]
/** The long-content stand-in for row one: exactly 40 characters of name. */
export const LONG: Member = {
  name: "Maximiliana Oyelaran-Vandenberghe Castro",
  title: "Senior Manager, Revenue Accounting and Intercompany Reconciliation, EMEA · Lisbon office",
  role: "Admin",
  tone: ["#D9E4EC", "#2E5470"],
}
const initials = (n: string) => n.split(" ").map((w) => w[0]).slice(0, 2).join("")

/* ── MemberList ─────────────────────────────────────────────────────────── */

export const CARD_W = 400
export const CARD_H = 344
const HEAD_H = 64
const FOOT_H = 40
const ROW_H = 60
const LONG_H = 94
const HOVER_ROW = 1

export type Layers = { rows?: number; loading?: number; empty?: number; error?: number }

function Avatar({ m }: { m: Member }) {
  return (
    <span className="grid size-[34px] shrink-0 place-items-center rounded-full text-[12px] font-semibold" style={{ background: m.tone[0], color: m.tone[1] }}>
      {initials(m.name)}
    </span>
  )
}

const Role = ({ role }: { role: string }) => (
  <span className="flex h-[22px] items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap" style={{ background: "rgba(29,28,26,0.05)", color: "rgba(29,28,26,0.7)" }}>
    {role}
  </span>
)

/** One member's row content (avatar, name, title); the role sits outside so it can slide on hover. */
function Person({ m, long = false }: { m: Member; long?: boolean }) {
  return (
    <div className="flex gap-3 pt-3 pr-[96px] pl-4">
      <Avatar m={m} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] leading-[18px] font-semibold" style={{ color: INK }}>
          {m.name}
        </div>
        <div className={cn("mt-0.5 text-[12px] leading-[16px]", long ? "line-clamp-3" : "truncate")} style={{ color: MUTED }}>
          {m.title}
        </div>
      </div>
    </div>
  )
}

function Rows({ hover, long }: { hover: number; long: number }) {
  const h0 = mix(ROW_H, LONG_H, long)
  return (
    <div className="absolute inset-x-0 overflow-hidden" style={{ top: HEAD_H, bottom: FOOT_H, maskImage: "linear-gradient(to bottom, black calc(100% - 22px), transparent)" }}>
      {MEMBERS.map((m, i) => {
        const top = i === 0 ? 0 : h0 + (i - 1) * ROW_H
        const height = i === 0 ? h0 : ROW_H
        const hov = i === HOVER_ROW ? hover : 0
        const role = i === 0 && long > 0.5 ? LONG.role : m.role
        return (
          <div key={i} className="absolute inset-x-0" style={{ top, height, borderTop: i > 0 ? `1px solid ${LINE}` : undefined }}>
            <div className="absolute inset-x-1.5 inset-y-1 rounded-[8px]" style={{ background: "#F4F3EE", opacity: hov }} />
            <div className="absolute inset-x-0 top-0" style={{ opacity: i === 0 ? 1 - long : 1 }}>
              <Person m={m} />
            </div>
            {i === 0 && long > 0 && (
              <div className="absolute inset-x-0 top-0" style={{ opacity: long }}>
                <Person m={LONG} long />
              </div>
            )}
            <div className="absolute top-[18px] right-4 flex items-center gap-1.5" style={{ transform: `translateX(${-30 * hov}px)` }}>
              <Role role={role} />
            </div>
            {hov > 0 && (
              <span className="absolute top-[16px] right-3 grid size-[26px] place-items-center rounded-[7px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.08]" style={{ opacity: hov }}>
                <MoreHorizontal size={14} color={INK} />
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Bone({ w, h = 10, className }: { w: number | string; h?: number; className?: string }) {
  return <span className={cn("ms-bone block rounded-full", className)} style={{ width: w, height: h }} />
}

function Loading() {
  return (
    <div className="absolute inset-x-0 overflow-hidden bg-white" style={{ top: HEAD_H, bottom: 0 }}>
      {[132, 108, 120, 96].map((w, i) => (
        <div key={i} className="flex items-start gap-3 px-4 pt-3" style={{ height: ROW_H, borderTop: i > 0 ? `1px solid ${LINE}` : undefined }}>
          <Bone w={34} h={34} />
          <div className="flex-1 pt-[3px]">
            <Bone w={w} h={11} />
            <Bone w={w * 0.75 + 20} h={9} className="mt-[9px]" />
          </div>
          <Bone w={58} h={20} className="mt-[2px]" />
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-0 flex items-center px-4" style={{ height: FOOT_H, borderTop: `1px solid ${LINE}` }}>
        <Bone w={110} h={9} />
      </div>
    </div>
  )
}

function Message({ icon, tint, title, body, action }: { icon: ReactNode; tint: string; title: string; body: string; action: ReactNode }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-center bg-white px-10 pb-2 text-center" style={{ top: HEAD_H }}>
      <span className="grid size-10 place-items-center rounded-full" style={{ background: tint }}>
        {icon}
      </span>
      <div className="mt-3 text-[14px] font-semibold" style={{ color: INK }}>
        {title}
      </div>
      <div className="mt-1 text-[12px] leading-[17px]" style={{ color: MUTED }}>
        {body}
      </div>
      <div className="mt-4">{action}</div>
    </div>
  )
}

const Empty = () => (
  <Message
    icon={<Users size={18} color={PINE} strokeWidth={2} />}
    tint="#E3ECE7"
    title="No members yet"
    body="Invite the people who review and approve bills for Whitlock & Co."
    action={
      <span className="flex h-8 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-semibold text-white" style={{ background: PINE }}>
        <Plus size={14} strokeWidth={2.4} />
        Invite people
      </span>
    }
  />
)

const Failed = () => (
  <Message
    icon={<TriangleAlert size={18} color="#B4361F" strokeWidth={2} />}
    tint="#F7E3DD"
    title="Couldn't load members"
    body="The request timed out after 10 seconds. Nothing on your team has changed."
    action={
      <span className="flex h-8 items-center gap-1.5 rounded-[8px] bg-white px-3 text-[12.5px] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.12]" style={{ color: INK }}>
        <RotateCw size={13} strokeWidth={2.2} />
        Try again
      </span>
    }
  />
)

const fadeUp = (o: number) => ({ opacity: o, transform: `translateY(${(1 - o) * 6}px)` })

export function MemberList({ layers = { rows: 1 }, hover = 0, long = 0, className }: { layers?: Layers; hover?: number; long?: number; className?: string }) {
  const { rows = 0, loading = 0, empty = 0, error = 0 } = layers
  const count = empty > 0.5 ? "0" : error > 0.5 ? "–" : "12"
  return (
    <div className={cn("relative overflow-hidden rounded-[12px] bg-white font-sans shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_-12px_rgba(0,0,0,0.18)] ring-1 ring-black/[0.06]", className)} style={{ width: CARD_W, height: CARD_H, color: INK }}>
      <div className="flex items-center justify-between px-4" style={{ height: HEAD_H, borderBottom: `1px solid ${LINE}` }}>
        <div>
          <div className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em]">
            Members
            <span className="relative grid h-[18px] min-w-[22px] place-items-center rounded-full px-1.5 text-[11px] font-medium tabular-nums" style={{ background: "rgba(29,28,26,0.06)", color: MUTED }}>
              <span style={{ opacity: 1 - loading }}>{count}</span>
            </span>
          </div>
          <div className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
            Whitlock &amp; Co. · Finance workspace
          </div>
        </div>
        <span className="flex h-8 items-center gap-1 rounded-[8px] px-2.5 text-[12.5px] font-semibold text-white" style={{ background: PINE }}>
          <Plus size={14} strokeWidth={2.4} />
          Invite
        </span>
      </div>
      {rows > 0 && (
        <div className="absolute inset-0" style={{ opacity: rows }}>
          <Rows hover={hover} long={long} />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-4 text-[12px]" style={{ height: FOOT_H, borderTop: `1px solid ${LINE}`, color: MUTED }}>
            <span className="tabular-nums">Showing 4 of 12</span>
            <span className="font-semibold" style={{ color: PINE }}>
              View all
            </span>
          </div>
        </div>
      )}
      {loading > 0 && (
        <div className="absolute inset-0" style={{ opacity: loading }}>
          <Loading />
        </div>
      )}
      {empty > 0 && (
        <div className="absolute inset-0" style={fadeUp(empty)}>
          <Empty />
        </div>
      )}
      {error > 0 && (
        <div className="absolute inset-0" style={fadeUp(error)}>
          <Failed />
        </div>
      )}
      <style>{`@keyframes ms-bone { from { background-position: 150% 0 } to { background-position: -50% 0 } }
.ms-bone { background: linear-gradient(90deg, #EFEEE9 0%, #EFEEE9 35%, #F8F7F4 50%, #EFEEE9 65%, #EFEEE9 100%); background-size: 200% 100%; animation: ms-bone 1.4s linear infinite }
@media (prefers-reduced-motion: reduce) { .ms-bone { animation: none } }`}</style>
    </div>
  )
}

/* ── The state bar ──────────────────────────────────────────────────────── */

export const STATES = ["Default", "Hover", "Loading", "Empty", "Error", "Long text"] as const
const PILLS = [...STATES, "All states"]
const PILL_W = [60, 52, 64, 56, 50, 70, 92]
const GAP = 2
const DIVIDER = 11
const PAD = 3
export const BAR_H = 34
const pillX = (i: number) => PAD + PILL_W.slice(0, i).reduce((s, w) => s + w + GAP, 0) + (i === 6 ? DIVIDER - GAP : 0)
export const BAR_W = pillX(6) + PILL_W[6] + PAD
/** Centre of pill i, in bar px. */
export const PILL_AT = (i: number): [number, number] => [pillX(i) + PILL_W[i] / 2, BAR_H / 2]

/** The states as props, for the single-state instances in the All states grid. */
export const STATE_PROPS: { layers: Layers; hover?: number; long?: number }[] = [
  { layers: { rows: 1 } },
  { layers: { rows: 1 }, hover: 1 },
  { layers: { loading: 1 } },
  { layers: { empty: 1 } },
  { layers: { error: 1 } },
  { layers: { rows: 1 }, long: 1 },
]

/** `at` is the selected pill, continuous while the thumb glides (2.5 = halfway from Loading to Empty). */
export function StateBar({ at, className }: { at: number; className?: string }) {
  const i0 = Math.floor(at)
  const i1 = Math.min(PILLS.length - 1, i0 + 1)
  const p = at - i0
  const x = mix(pillX(i0), pillX(i1), p)
  const w = mix(PILL_W[i0], PILL_W[i1], p)
  const on = Math.round(at)
  return (
    <div className={cn("relative rounded-[10px] font-sans", className)} style={{ width: BAR_W, height: BAR_H, background: "#E6E4DD" }}>
      <div className="absolute rounded-[8px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.1),0_2px_6px_-2px_rgba(0,0,0,0.08)]" style={{ left: x, top: PAD, width: w, height: BAR_H - 2 * PAD }} />
      <span className="absolute w-px" style={{ left: pillX(6) - DIVIDER / 2 - 0.5, top: 9, bottom: 9, background: "rgba(29,28,26,0.15)" }} />
      {PILLS.map((label, i) => (
        <span
          key={label}
          className="absolute flex items-center justify-center gap-1 text-[11.5px] font-medium whitespace-nowrap transition-colors duration-200"
          style={{ left: pillX(i), top: PAD, width: PILL_W[i], height: BAR_H - 2 * PAD, color: i === on ? INK : "rgba(29,28,26,0.55)" }}
        >
          {i === 6 && <LayoutGrid size={12} strokeWidth={2.2} />}
          {label}
        </span>
      ))}
    </div>
  )
}
