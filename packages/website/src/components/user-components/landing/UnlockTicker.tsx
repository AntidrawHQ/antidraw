/**
 * Variations on the "bring any library" ticker (landing/Unlocks' Ticker): one sentence, "use Motion
 * to build micro-interactions", that cycles through the libraries with each one's preview.
 * LandingUnlocks compares them.
 *
 *  - split   the sentence stacked on the left, the preview beside it (the first one)
 *  - slot    centred; the library and the outcome roll in like a slot machine, the preview below
 *  - story   the preview large, story-style progress segments above, the sentence under it
 *  - prompt  the sentence typed into a chat box as a request, its preview appearing once it's sent
 *  - reel    every preview in a strip that slides the current one to the centre, the sentence above
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowUp } from "lucide-react"

import { cn } from "@/lib/utils"
import { BigMark } from "../libraries/catalog"
import { Heading, KEYFRAMES, Preview, TONE, Ticker, UNLOCKS, useOnScreen } from "./Unlocks"

export type TickerStyle = "split" | "slot" | "story" | "prompt" | "reel"

export const TICKER_STYLES: { id: TickerStyle; name: string; note: string }[] = [
  { id: "split", name: "Split", note: "The first one: the sentence stacked on the left, its preview beside it." },
  { id: "slot", name: "Slot machine", note: "Centred, one sentence; the library and the outcome roll over in place, the preview below." },
  { id: "story", name: "Story", note: "The preview large, with story-style progress above and the sentence under it." },
  { id: "prompt", name: "Prompt", note: "The sentence typed into a chat box as a request; its preview appears once it's sent." },
  { id: "reel", name: "Reel", note: "Every preview in a strip that slides the current one to the centre; the others stay visible." },
]

type Theme = "dark" | "light"
const N = UNLOCKS.length
const EASE = [0.3, 0.7, 0.2, 1] as const

/** Steps through the pairs every `ms` while on screen. Picking one starts the count over. */
function useCycle(on: boolean, ms: number) {
  const [i, setI] = useState(0)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => setI((n) => (n + 1) % N), ms)
    return () => clearInterval(id)
  }, [on, ms, tick])
  const pick = (n: number) => (setI(n), setTick((x) => x + 1))
  return [i, pick] as const
}

/** The libraries as marks to jump between, the current one lit. */
function Dots({ i, pick, theme, className }: { i: number; pick: (n: number) => void; theme: Theme; className?: string }) {
  const t = TONE[theme]
  return (
    <div className={cn("flex flex-wrap items-center justify-center gap-2", className)}>
      {UNLOCKS.map((x, n) => (
        <button key={x.outcome} type="button" onClick={() => pick(n)} title={`${x.lib.library} → ${x.outcome}`} className={cn("rounded-xl p-1 transition-opacity", n === i ? "opacity-100" : "opacity-35 hover:opacity-70")}>
          <BigMark mark={x.lib.mark} size={32} radius={8} />
        </button>
      ))}
      <span className={cn("ml-2 text-[14px]", t.quiet)}>and anything else on npm</span>
    </div>
  )
}

/** A word that rolls up out of a clipped slot when it changes; the slot eases to the new word's width. */
function Roll({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <motion.span layout transition={{ layout: { duration: 0.55, ease: EASE } }} className={cn("relative inline-flex overflow-hidden align-bottom", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={id}
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-100%", opacity: 0 }}
          transition={{ duration: 0.55, ease: EASE }}
          className="inline-flex items-center gap-[0.28em] whitespace-nowrap"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </motion.span>
  )
}

/* ── Slot machine ─────────────────────────────────────────────────────── */

function Slot({ theme, on }: { theme: Theme; on: boolean }) {
  const t = TONE[theme]
  const [i, pick] = useCycle(on, 3000)
  const u = UNLOCKS[i]
  return (
    <div>
      <Heading theme={theme} center />
      <div className={cn("mt-20 text-center text-[36px] leading-[1.25] font-medium tracking-[-0.03em] sm:text-[56px]", t.quiet)}>
        <div>
          use{" "}
          <Roll id={u.lib.library} className={cn("py-[0.06em]", t.ink)}>
            <BigMark mark={u.lib.mark} size={48} radius={12} />
            {u.lib.library}
          </Roll>
        </div>
        <div>
          to{" "}
          <Roll id={u.verb + i} className="py-[0.06em]">
            {u.verb}
          </Roll>{" "}
          <Roll id={u.outcome} className={cn("py-[0.06em]", t.ink)}>
            {u.outcome}.
          </Roll>
        </div>
      </div>
      <div className="mx-auto mt-14 max-w-[720px]">
        <Preview key={i} kind={u.kind} theme={theme} className={cn("aspect-[3/2] w-full animate-in rounded-2xl ring-1 duration-500 fade-in zoom-in-[0.98]", t.card)} />
      </div>
      <Dots i={i} pick={pick} theme={theme} className="mt-10" />
    </div>
  )
}

/* ── Story ────────────────────────────────────────────────────────────── */

function Story({ theme, on }: { theme: Theme; on: boolean }) {
  const t = TONE[theme]
  const MS = 4200
  const [i, pick] = useCycle(on, MS)
  const u = UNLOCKS[i]
  return (
    <div>
      <Heading theme={theme} />
      <div className="mt-16">
        {/* One segment per library: the past ones full, the current one filling. */}
        <div className="mb-4 flex gap-1.5">
          {UNLOCKS.map((x, n) => (
            <button key={x.outcome} type="button" onClick={() => pick(n)} title={x.lib.library} className="group h-5 flex-1 py-2">
              <span className={cn("block h-[3px] overflow-hidden rounded-full", theme === "dark" ? "bg-white/[0.12]" : "bg-black/[0.08]")}>
                <span
                  key={n === i ? `on${i}` : n}
                  className={cn("block h-full origin-left rounded-full", theme === "dark" ? "bg-white" : "bg-[#171717]")}
                  style={{ transform: n < i ? "scaleX(1)" : "scaleX(0)", animation: n === i && on ? `ul-bar ${MS}ms linear forwards` : undefined }}
                />
              </span>
            </button>
          ))}
        </div>
        <Preview key={i} kind={u.kind} theme={theme} className={cn("aspect-[2/1] w-full animate-in rounded-2xl ring-1 duration-500 fade-in", t.card)} />
        <div className="mt-8 grid items-baseline gap-4 sm:grid-cols-[minmax(0,1fr)_320px] sm:gap-12">
          <div key={`s${i}`} className={cn("flex animate-in flex-wrap items-center gap-x-[0.3em] text-[26px] leading-[1.25] tracking-[-0.022em] duration-500 fade-in slide-in-from-bottom-1 sm:text-[34px]", t.quiet)}>
            use
            <BigMark mark={u.lib.mark} size={34} radius={9} />
            <span className={cn("font-medium", t.ink)}>{u.lib.library}</span> to {u.verb} <span className={cn("font-medium", t.ink)}>{u.outcome}</span>
          </div>
          <p key={`l${i}`} className={cn("animate-in text-[16px] leading-[1.5] text-pretty duration-500 fade-in", t.soft)}>
            {u.line}
          </p>
        </div>
      </div>
      <style>{`@keyframes ul-bar { from { transform: scaleX(0) } to { transform: scaleX(1) } }`}</style>
    </div>
  )
}

/* ── Prompt ───────────────────────────────────────────────────────────── */

/** Types each sentence, sends it, holds the preview, then deletes it and moves on. */
function usePrompt(on: boolean) {
  const [i, setI] = useState(0)
  const [n, setN] = useState(0)
  const [phase, setPhase] = useState<"type" | "hold" | "erase">("type")
  const u = UNLOCKS[i]
  const text = `use ${u.lib.library} to ${u.verb} ${u.outcome}`
  useEffect(() => {
    if (!on) return
    let id = 0
    if (phase === "type") id = n < text.length ? window.setTimeout(() => setN(n + 1), 38 + Math.random() * 40) : window.setTimeout(() => setPhase("hold"), 380)
    else if (phase === "hold") id = window.setTimeout(() => setPhase("erase"), 2800)
    else id = n > 0 ? window.setTimeout(() => setN(n - 1), 14) : window.setTimeout(() => (setI((i + 1) % N), setPhase("type")), 240)
    return () => clearTimeout(id)
  }, [on, phase, n, text, i])
  const pick = (k: number) => (setI(k), setN(0), setPhase("type"))
  return { i, n, phase, text, pick }
}

function Prompt({ theme, on }: { theme: Theme; on: boolean }) {
  const t = TONE[theme]
  const { i, n, phase, pick } = usePrompt(on)
  const u = UNLOCKS[i]
  // The typed text in its parts, so the library and the outcome can stand out as they're typed.
  const parts: [string, boolean][] = [
    ["use ", false],
    [u.lib.library, true],
    [` to ${u.verb} `, false],
    [u.outcome, true],
  ]
  let left = n
  const typed = parts.map(([s, strong]) => {
    const shown = s.slice(0, Math.max(0, left))
    left -= s.length
    return [shown, strong] as const
  })
  const sent = phase === "hold"
  const box = theme === "dark" ? "bg-[#2e2e2e] ring-white/[0.09] shadow-[0_18px_44px_-24px_rgba(0,0,0,0.7)]" : "bg-white ring-black/[0.07] shadow-[0_18px_44px_-24px_rgba(0,0,0,0.25)]"
  return (
    <div>
      <Heading theme={theme} center />
      <div className="mx-auto mt-16 max-w-[760px]">
        <div className={cn("flex items-center gap-4 rounded-[22px] py-3 pr-3 pl-6 ring-1", box)}>
          <div className="min-w-0 flex-1 truncate text-[20px] tracking-[-0.014em] sm:text-[24px]">
            {typed.map(([s, strong], k) => (
              <span key={k} className={strong ? cn("font-medium", t.ink) : t.soft}>
                {s}
              </span>
            ))}
            <span className={cn("ml-px inline-block h-[1.05em] w-[2px] translate-y-[0.18em] rounded-full", theme === "dark" ? "bg-white" : "bg-[#171717]", phase === "hold" ? "animate-pulse" : "")} />
          </div>
          <span className={cn("grid size-11 shrink-0 place-items-center rounded-full transition-all duration-300", sent ? "scale-95" : "", n > 0 ? (theme === "dark" ? "bg-white text-[#171717]" : "bg-[#171717] text-white") : theme === "dark" ? "bg-white/[0.08] text-white/40" : "bg-black/[0.05] text-black/30")}>
            <ArrowUp className="size-5" strokeWidth={2.2} />
          </span>
        </div>
        {/* The answer: what that library makes, once the request is sent. */}
        <div className="relative mt-6 aspect-[3/2]">
          <div className={cn("absolute inset-0 rounded-2xl border border-dashed transition-opacity duration-500", t.dash, sent ? "opacity-0" : "opacity-100")} />
          {sent && <Preview key={i} kind={u.kind} theme={theme} className={cn("absolute inset-0 animate-in rounded-2xl ring-1 duration-700 fade-in slide-in-from-top-2", t.card)} />}
        </div>
      </div>
      <Dots i={i} pick={pick} theme={theme} className="mt-10" />
    </div>
  )
}

/* ── Reel ─────────────────────────────────────────────────────────────── */

function Reel({ theme, on }: { theme: Theme; on: boolean }) {
  const t = TONE[theme]
  const [i, pick] = useCycle(on, 3200)
  const u = UNLOCKS[i]
  const W = 360
  const GAP = 24
  // The strip's own width, so the current preview can be slid to its middle.
  const strip = useRef<HTMLDivElement>(null)
  const [sw, setSw] = useState(1000)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setSw(e.contentRect.width))
    ro.observe(strip.current!)
    return () => ro.disconnect()
  }, [])
  return (
    <div>
      <Heading theme={theme} center />
      <div className={cn("mt-16 text-center text-[32px] leading-[1.2] font-medium tracking-[-0.03em] sm:text-[48px]", t.quiet)}>
        use{" "}
        <Roll id={u.lib.library} className={t.ink}>
          {u.lib.library}
        </Roll>{" "}
        to{" "}
        <Roll id={u.outcome} className={t.ink}>
          {u.verb} {u.outcome}.
        </Roll>
      </div>
      {/* The strip, slid so the current preview sits in the middle; the edges fade into the page. */}
      <div ref={strip} className="relative mt-14 overflow-hidden" style={{ maskImage: "linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent)" }}>
        <motion.div className="flex" style={{ gap: GAP, width: "max-content" }} animate={{ x: sw / 2 - (i * (W + GAP) + W / 2) }} transition={{ duration: 0.7, ease: EASE }}>
          {UNLOCKS.map((x, n) => (
            <button key={x.outcome} type="button" onClick={() => pick(n)} className="shrink-0 text-left" style={{ width: W }}>
              <motion.div animate={{ scale: n === i ? 1 : 0.86, opacity: n === i ? 1 : 0.45 }} transition={{ duration: 0.6, ease: EASE }}>
                <Preview kind={x.kind} theme={theme} className={cn("aspect-[3/2] w-full rounded-2xl ring-1", t.card)} />
                <span className={cn("mt-4 flex items-center justify-center gap-2 text-[14px] transition-opacity", n === i ? "opacity-100" : "opacity-0", t.soft)}>
                  <BigMark mark={x.lib.mark} size={20} radius={5} />
                  {x.lib.library}
                </span>
              </motion.div>
            </button>
          ))}
        </motion.div>
      </div>
      <p className={cn("mt-8 text-center text-[14px]", t.quiet)}>and anything else on npm</p>
    </div>
  )
}

/** One variation, as its own section. */
export function UnlockTickerSection({ style, theme = "dark", className }: { style: TickerStyle; theme?: Theme; className?: string }) {
  const [ref, on] = useOnScreen()
  return (
    <section ref={ref} data-off={on ? undefined : ""} className={cn("ul-root", className)}>
      <style>{KEYFRAMES}</style>
      {style === "split" ? <Ticker theme={theme} on={on} /> : style === "slot" ? <Slot theme={theme} on={on} /> : style === "story" ? <Story theme={theme} on={on} /> : style === "prompt" ? <Prompt theme={theme} on={on} /> : <Reel theme={theme} on={on} />}
    </section>
  )
}
