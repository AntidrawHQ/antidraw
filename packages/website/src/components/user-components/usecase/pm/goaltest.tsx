/**
 * "Test it with users" pieces, in the sprout brand (goals.tsx, goalflow.tsx):
 *
 *  - GoalAmountEdit  GoalAmount after the fix: the amount is a field you can
 *                    tap and type into (a number pad slides up), and the
 *                    chips stay as shortcuts
 *  - ResearchNotes   the PM's test doc (wiki-style, like GoalsPrd): the task,
 *                    then each session's timestamped notes and outcome
 *
 * Screens are 300×600; the *_AT points are frame px.
 */
import type { ReactNode } from "react"
import { Delete, Pencil } from "lucide-react"

import { cn } from "@/lib/utils"
import { DEEP, LIME, PALE } from "../../motion/mvf/fintech"
import { SpButton, SpChip, SpIcon } from "./goals"
import { AMOUNT_HEAD, AMOUNTS } from "./goalflow"

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`

/** Where the old GoalAmount's big number sits (what testers tap, to no effect). */
export const OLD_AMOUNT_AT: [number, number] = [150, 248]
/** The amount field on GoalAmountEdit. */
export const FIELD_AT: [number, number] = [150, 254]

const PAD_Y = 362
const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"]
/** Centre of a number-pad key, and of its Done. */
export const KEY_AT = (k: string): [number, number] => {
  const i = PAD_KEYS.indexOf(k)
  return [52 + (i % 3) * 98, PAD_Y + 44 + 22 + Math.floor(i / 3) * 50]
}
export const PAD_DONE_AT: [number, number] = [258, PAD_Y + 18]

/**
 * `amount` is what the field shows (0 shows it empty while typing);
 * `chip` the preset that matches it (-1 none); `focus` puts the caret in
 * and rings the field; `pad` 0→1 slides the number pad up; `flash` 0→1→0
 * is the agent's highlight as it lands the change.
 */
export function GoalAmountEdit({ amount = 1000, chip = 1, focus = false, pad = 0, flash = 0 }: { amount?: number; chip?: number; focus?: boolean; pad?: number; flash?: number }) {
  const h = AMOUNT_HEAD
  return (
    <div className="absolute inset-0 overflow-hidden font-sans" style={{ background: PALE, color: DEEP }}>
      <div className="flex justify-between px-5 pt-2.5 text-[11px] font-semibold">
        <span>9:41</span>
        <span>●●● ▮</span>
      </div>
      <div className="absolute overflow-hidden" style={{ left: h.x, top: h.y, width: h.w, height: h.h, borderRadius: h.r, background: DEEP, color: LIME }}>
        <div className="absolute top-5 left-5">
          <SpIcon icon="trip" size={36} />
        </div>
        <span className="absolute top-6 right-5 text-[11.5px] font-semibold opacity-60">Step 2 of 3</span>
        <span className="absolute bottom-5 left-5 text-[24px] leading-[1.1] font-black tracking-[-0.03em]">How much for A trip?</span>
      </div>
      <div
        className="absolute inset-x-6 top-[222px] flex h-[64px] items-center justify-center rounded-[16px] bg-white transition-shadow duration-200"
        style={{ boxShadow: focus ? `inset 0 0 0 2px ${DEEP}` : "inset 0 0 0 1px rgba(13,74,18,0.16)" }}
      >
        <span className={cn("text-[38px] leading-none font-black tracking-[-0.04em] tabular-nums", amount === 0 && "opacity-25")}>{amount === 0 ? "$0" : money(amount)}</span>
        {focus && <span className="gt-caret ml-1 h-[34px] w-[2px]" style={{ background: DEEP }} />}
        {!focus && <Pencil size={14} className="absolute right-4 opacity-40" />}
        <div className="pointer-events-none absolute -inset-1 rounded-[19px]" style={{ boxShadow: `0 0 0 2px #3b82f6, 0 0 0 7px rgba(59,130,246,0.18)`, opacity: flash }} />
      </div>
      <div className="absolute inset-x-0 top-[296px] text-center text-[12px] font-medium tabular-nums opacity-55">by March · {money(amount / 12)} a month</div>
      <div className="absolute top-[322px] left-[28px] flex gap-2">
        {AMOUNTS.map((a, i) => (
          <SpChip key={a} selected={chip === i} className="w-[76px]">
            {money(a)}
          </SpChip>
        ))}
      </div>
      <div className="absolute inset-x-6 top-[384px]">
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
      {pad > 0 && (
        <div className="absolute inset-x-0 bottom-0 bg-[#e3ecd0] shadow-[0_-8px_24px_rgba(13,74,18,0.12)]" style={{ top: PAD_Y, transform: `translateY(${(1 - pad) * 100}%)` }}>
          <div className="flex h-9 items-center justify-end border-b border-black/[0.06] px-5 text-[13px] font-semibold">Done</div>
          <div className="grid grid-cols-3 gap-x-[6px] gap-y-[6px] px-[6px] pt-2">
            {PAD_KEYS.map((k, i) => (
              <span key={i} className={cn("grid h-[44px] place-items-center rounded-[8px] text-[20px] font-medium", k && k !== "del" && "bg-white shadow-[0_1px_0_rgba(0,0,0,0.12)]")}>
                {k === "del" ? <Delete size={18} /> : k}
              </span>
            ))}
          </div>
        </div>
      )}
      <style>{`@keyframes gt-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .gt-caret { animation: gt-caret 1s step-end infinite }`}</style>
    </div>
  )
}

/* ── The test doc ───────────────────────────────────────────────────────── */

export const NOTES_W = 440
export const NOTES_H = 420

const INK = "#37352f"
const GREY = "#787774"

export type Note = { at: string; text: string }
export type Session = { name: string; who: string; notes: Note[]; outcome?: { label: string; good: boolean } }

/** `shown[i]` is how many of session i's notes are in; `outcome[i]` shows its result tag; `live` marks the running one. */
export function ResearchNotes({ sessions, shown, outcome, live = -1, className }: { sessions: Session[]; shown: number[]; outcome: boolean[]; live?: number; className?: string }) {
  const Prop = ({ k, children }: { k: string; children: ReactNode }) => (
    <div className="flex h-[22px] items-center text-[11px]">
      <span className="w-[64px] shrink-0" style={{ color: GREY }}>
        {k}
      </span>
      {children}
    </div>
  )
  return (
    <div className={cn("relative overflow-hidden rounded-[6px] bg-white px-6 pt-4 font-sans shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)]", className)} style={{ width: NOTES_W, height: NOTES_H, color: INK }}>
      <div className="text-[10px]" style={{ color: GREY }}>
        Research <span className="opacity-50">/</span> Savings goals
      </div>
      <div className="mt-2.5 text-[22px] leading-none">🧪</div>
      <div className="mt-1.5 text-[20px] leading-tight font-bold tracking-[-0.01em]">New goal flow · usability test</div>
      <div className="mt-1.5 border-b border-black/[0.08] pb-1.5">
        <Prop k="Prototype">
          <span className="rounded-[3px] bg-black/[0.05] px-1.5 font-mono text-[10.5px] leading-[17px]">GoalFlow</span>
        </Prop>
        <Prop k="Task">Set up a goal for a $1,500 trip</Prop>
      </div>
      {sessions.map((s, i) => (
        <div key={s.name} className={cn("mt-3 transition-opacity duration-300", shown[i] === 0 && live !== i && "opacity-0")}>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">{s.name}</span>
            <span className="text-[11.5px]" style={{ color: GREY }}>
              {s.who}
            </span>
            {live === i && (
              <span className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.04em] text-[#e03e3e] uppercase">
                <span className="gt-live size-[6px] rounded-full bg-[#e03e3e]" />
                Live
              </span>
            )}
            {s.outcome && outcome[i] && (
              <span className={cn("gt-pop ml-auto rounded-[3px] px-1.5 text-[10.5px] leading-[18px] font-medium", s.outcome.good ? "bg-[#dbeddb] text-[#1c3829]" : "bg-[#fadec9] text-[#49290e]")}>{s.outcome.label}</span>
            )}
          </div>
          <div className="mt-1 flex flex-col gap-[3px]">
            {s.notes.slice(0, shown[i]).map((n) => (
              <div key={n.at} className="gt-in flex items-start gap-2.5 text-[11.5px] leading-[1.5]">
                <span className="mt-px shrink-0 font-mono text-[10.5px] tabular-nums" style={{ color: GREY }}>
                  {n.at}
                </span>
                <span>{n.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <style>{`@keyframes gt-in { from { opacity: 0; transform: translateY(4px) } } .gt-in { animation: gt-in .3s cubic-bezier(.22,1,.36,1) both }
@keyframes gt-pop { from { opacity: 0; transform: scale(.85) } } .gt-pop { animation: gt-pop .25s cubic-bezier(.22,1,.36,1) both }
@keyframes gt-live { 50% { opacity: .3 } } .gt-live { animation: gt-live 1.2s ease-in-out infinite }`}</style>
    </div>
  )
}
