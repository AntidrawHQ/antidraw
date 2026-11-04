/**
 * "CoffeeCollection": Halcyon's shop page for its single-origin coffees
 * (usecase/marketing/brand.tsx Halcyon mark and day palette), written as one
 * responsive layout that's a pure function of the viewport width `vw`, so a
 * scene can drag a frame and have the page reflow like real CSS:
 *
 *  - ≥1120  filter sidebar on the left, a 3-column grid, nav links
 *  - ~1050  the sidebar folds up into a bar of roast chips above the grid
 *  - ~910   the grid goes from 3 columns to 2
 *  - ~700   the nav links give way to a menu button; the logo moves to the middle
 *  - ~510   the grid goes to 1 column
 *
 * Each switch is blended over a band of widths (positions interpolated
 * against `vw`) so a live drag slides things into place instead of cutting;
 * cards that change rows lift over the others on the way.
 * The headline and copy wrap as the browser wraps them; the block under the
 * hero eases to its new height. `menu` (0→1) opens the phone menu sheet.
 * Natural size vw × PAGE_H.
 */
import { useLayoutEffect, useRef, useState } from "react"
import { ChevronRight, Menu, Search, ShoppingBag, SlidersHorizontal, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { mix } from "../../motion/canvas-ai/kit"
import { HalcyonMark, THEMES } from "../marketing/brand"

export const PAGE_H = 700

const { paper: PAPER, ink: INK, accent: ACCENT } = THEMES.day
const BAR_H = 30
const HEAD_H = 60
const SIDE_W = 196
const SIDE_GAP = 32
const FILTER_H = 40
const TEXT_H = 86

/* ── Width → layout ──────────────────────────────────────────────────── */

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
/** 0 at `from` (wider), 1 at `to` (narrower), smoothstepped between. */
const band = (vw: number, from: number, to: number) => {
  const p = clamp01((from - vw) / (from - to))
  return p * p * (3 - 2 * p)
}
/** A fluid value pinned at a few widths, linear in between (like clamp() + vw). */
const fluid = (vw: number, stops: readonly (readonly [number, number])[]) => {
  if (vw <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [w1, v1] = stops[i]
    if (vw <= w1) {
      const [w0, v0] = stops[i - 1]
      return mix(v0, v1, (vw - w0) / (w1 - w0))
    }
  }
  return stops[stops.length - 1][1]
}

export function layoutAt(vw: number) {
  return {
    side: band(vw, 1120, 980), // sidebar → chip bar
    two: band(vw, 980, 840), // grid 3 → 2
    menu: band(vw, 760, 640), // nav links → menu button
    one: band(vw, 580, 440), // grid 2 → 1
    pad: fluid(vw, [[390, 20], [768, 32], [1280, 40]]),
    gap: fluid(vw, [[390, 16], [1280, 22]]),
    h1: fluid(vw, [[390, 36], [768, 44], [1280, 56]]),
  }
}

/** Where the phone menu button sits, in page px (for the scene's pointer). */
export const menuButtonAt = (vw: number): [number, number] => [layoutAt(vw).pad + 16, BAR_H + HEAD_H / 2]

/* ── Data ────────────────────────────────────────────────────────────── */

type Coffee = { name: string; origin: string; process: string; notes: string; price: string; bag: string; plate: string; tag?: string }
const COFFEES: Coffee[] = [
  { name: "Kochere", origin: "Ethiopia", process: "Washed", notes: "Peach, jasmine, black tea", price: "£12.50", bag: ACCENT, plate: "#f6dcc0", tag: "New lot" },
  { name: "La Esperanza", origin: "Colombia", process: "Honey", notes: "Red apple, panela, cocoa", price: "£11.00", bag: INK, plate: "#dfe0f0" },
  { name: "Gakuyuni AA", origin: "Kenya", process: "Washed", notes: "Blackcurrant, grapefruit", price: "£14.00", bag: "#2f6b4f", plate: "#dbe6d6", tag: "Low stock" },
  { name: "Santa Lucía", origin: "Peru", process: "Washed", notes: "Milk chocolate, almond", price: "£10.50", bag: "#e3a92f", plate: "#f4e5c2" },
  { name: "Sítio Baixadão", origin: "Brazil", process: "Natural", notes: "Hazelnut, caramel, cherry", price: "£9.50", bag: "#7d4a2c", plate: "#ecdccb" },
  { name: "House espresso", origin: "Brazil & Colombia", process: "Blend", notes: "Dark chocolate, plum", price: "£9.00", bag: "#22201c", plate: "#e6e0d4" },
]
const NAV = ["Coffee", "Equipment", "Subscriptions", "Wholesale", "Visit us"]
const ROASTS: [string, number][] = [
  ["All coffees", 9],
  ["Light", 4],
  ["Medium", 3],
  ["Dark", 1],
  ["Espresso", 1],
]
const ORIGINS: [string, number][] = [
  ["Ethiopia", 2],
  ["Colombia", 2],
  ["Kenya", 1],
  ["Peru", 1],
  ["Brazil", 3],
]

/* ── Pieces ──────────────────────────────────────────────────────────── */

/** A 250g bag, natural 120×170: crimped top, valve, cream label. */
function Bag({ c }: { c: Coffee }) {
  return (
    <div className="relative" style={{ width: 120, height: 170 }}>
      <div
        className="absolute inset-x-[4px] top-0 h-[18px] rounded-t-[3px]"
        style={{ background: `repeating-linear-gradient(90deg, rgba(0,0,0,.18) 0 1px, transparent 1px 5px), ${c.bag}` }}
      />
      <div className="absolute inset-x-0 top-[14px] bottom-0 overflow-hidden rounded-[5px_5px_9px_9px]" style={{ background: c.bag }}>
        <div className="absolute inset-y-0 left-0 w-[12px] bg-black/[0.12]" />
        <div className="absolute inset-y-0 right-0 w-[8px] bg-white/[0.08]" />
        <span className="absolute top-[12px] right-[14px] size-[9px] rounded-full bg-black/15 ring-1 ring-black/20" />
        <div className="absolute inset-x-[15px] top-[36px] flex h-[88px] flex-col items-center justify-center rounded-[3px] text-center" style={{ background: PAPER, color: INK }}>
          <HalcyonMark size={17} color={INK} />
          <div className="mt-1 px-1 font-serif text-[13px] leading-[1.05] italic">{c.name}</div>
          <div className="mt-1 text-[6.5px] font-semibold tracking-[0.12em] uppercase opacity-60">250g · whole bean</div>
        </div>
      </div>
    </div>
  )
}

function Card({ c, w, img, lift = 0 }: { c: Coffee; w: number; img: number; lift?: number }) {
  const s = (img * 0.74) / 170
  return (
    <div
      className="absolute inset-0 rounded-[12px]"
      style={{ color: INK, background: lift > 0 ? PAPER : undefined, boxShadow: lift > 0 ? `0 ${16 * lift}px ${32 * lift}px -14px rgba(27,43,214,${0.35 * lift})` : undefined, transform: `scale(${1 + lift * 0.02})` }}
    >
      <div className="relative overflow-hidden rounded-[12px]" style={{ height: img, background: c.plate }}>
        <div className="absolute bottom-[11%] left-1/2 h-[8%] w-[46%] -translate-x-1/2 rounded-[50%] bg-black/[0.07]" style={{ width: 120 * s * 1.15 }} />
        <div className="absolute left-1/2 origin-bottom" style={{ bottom: img * 0.13, width: 120, height: 170, marginLeft: -60, transform: `scale(${s})` }}>
          <Bag c={c} />
        </div>
        {c.tag && <span className="absolute top-3 left-3 rounded-full bg-white/80 px-2.5 py-[3px] text-[11px] font-semibold">{c.tag}</span>}
      </div>
      <div className="flex items-baseline justify-between gap-3 pt-3">
        <span className="truncate font-serif text-[19px] leading-tight italic">{c.name}</span>
        <span className="shrink-0 text-[14px] font-semibold tabular-nums">{c.price}</span>
      </div>
      <div className="mt-0.5 truncate text-[13px] opacity-60" style={{ maxWidth: w }}>
        {c.origin} · {c.process}
      </div>
      <div className="mt-0.5 truncate text-[13px] opacity-80">{c.notes}</div>
    </div>
  )
}

function Sidebar() {
  return (
    <div className="text-[14px]" style={{ color: INK }}>
      <div className="text-[11px] font-semibold tracking-[0.12em] uppercase opacity-50">Roast</div>
      <div className="mt-2.5 flex flex-col gap-2">
        {ROASTS.map(([r, n], i) => (
          <div key={r} className={cn("flex items-center justify-between", i === 0 ? "font-semibold" : "opacity-75")}>
            <span className="flex items-center gap-2">
              <span className={cn("size-[6px] rounded-full", i === 0 ? "" : "opacity-0")} style={{ background: ACCENT }} />
              {r}
            </span>
            <span className="text-[12px] tabular-nums opacity-60">{n}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 text-[11px] font-semibold tracking-[0.12em] uppercase opacity-50">Origin</div>
      <div className="mt-2.5 flex flex-col gap-2">
        {ORIGINS.map(([o, n]) => (
          <div key={o} className="flex items-center justify-between opacity-75">
            <span className="flex items-center gap-2">
              <span className="size-[13px] rounded-[3px] border-[1.5px]" style={{ borderColor: `${INK}66` }} />
              {o}
            </span>
            <span className="text-[12px] tabular-nums opacity-60">{n}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FilterBar() {
  return (
    <div className="flex h-full items-center gap-2 text-[13px]" style={{ color: INK }}>
      <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 font-semibold" style={{ borderColor: `${INK}40` }}>
        <SlidersHorizontal className="size-3.5" strokeWidth={2} />
        Filters
      </span>
      <span className="h-5 w-px shrink-0" style={{ background: `${INK}26` }} />
      <div className="flex min-w-0 flex-1 gap-2 overflow-hidden [mask-image:linear-gradient(90deg,#000_85%,transparent)]">
        {ROASTS.map(([r], i) => (
          <span key={r} className="flex h-8 shrink-0 items-center rounded-full px-3 font-medium" style={i === 0 ? { background: INK, color: PAPER } : { background: `${INK}0f` }}>
            {r}
          </span>
        ))}
      </div>
    </div>
  )
}

/** The phone menu sheet, revealed down from the header by `p`. */
function MenuSheet({ p }: { p: number }) {
  if (p <= 0) return null
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 px-5 pt-2" style={{ top: BAR_H + HEAD_H, background: PAPER, color: INK, clipPath: `inset(0 0 ${(1 - p) * 100}% 0)` }}>
      {NAV.map((n, i) => (
        <div key={n} className="flex items-center justify-between border-b py-[15px] font-serif text-[26px] leading-none italic" style={{ borderColor: `${INK}1f`, opacity: clamp01(p * 1.6 - i * 0.12) }}>
          {n}
          <ChevronRight className="size-5 opacity-40" strokeWidth={1.75} />
        </div>
      ))}
      <div className="mt-6 text-[13px] leading-[1.5] opacity-70">
        Roastery &amp; café, open Sat 9–4
        <br />
        18 Ashwin Street, London E8
      </div>
      <div className="mt-5 rounded-[12px] p-4" style={{ background: INK, color: PAPER, opacity: clamp01(p * 1.6 - 0.7) }}>
        <div className="font-serif text-[20px] leading-tight italic">Never run out</div>
        <div className="mt-1 text-[13px] leading-[1.45] opacity-80">A fresh bag every two weeks from £9. Skip or pause any time.</div>
      </div>
    </div>
  )
}

/** Height of a box as laid out (unscaled), for easing what sits under it. */
function useHeight() {
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState<number>()
  useLayoutEffect(() => {
    const el = ref.current!
    setH(el.offsetHeight)
    const ro = new ResizeObserver(() => setH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, h] as const
}

/* ── The page ────────────────────────────────────────────────────────── */

export function CoffeeCollection({ vw, menu = 0 }: { vw: number; menu?: number }) {
  const L = layoutAt(vw)
  const [heroRef, heroH] = useHeight()
  // A jump in width (the loop wrapping back to desktop) shouldn't ease: skip the transition for a moment.
  const last = useRef({ vw, jumpAt: -Infinity })
  if (Math.abs(vw - last.current.vw) > 100) last.current.jumpAt = performance.now()
  last.current.vw = vw
  const ease = performance.now() - last.current.jumpAt > 600

  // Header: the links clear out first, then the logo slides to the middle and the menu button comes in.
  const linksOut = clamp01(L.menu * 2.5)
  const settle = clamp01((L.menu - 0.3) / 0.7)
  const logoX = mix(L.pad, vw / 2 - 52, settle)

  // Grid: the same six cards laid out at 3, 2 and 1 columns, blended.
  const gridX = L.pad + mix(SIDE_W + SIDE_GAP, 0, L.side)
  const gridY = mix(4, FILTER_H + 18, L.side)
  const gridW = vw - L.pad - gridX
  const weights: [number, number][] = [
    [3, 1 - L.two],
    [2, L.two * (1 - L.one)],
    [1, L.one],
  ]
  const aspect = fluid(vw, [[390, 0.56], [768, 0.62], [1280, 0.7]])
  const rowOf = (i: number, n: number) => Math.floor(i / n)
  const cards = COFFEES.map((_, i) => {
    let x = 0,
      y = 0,
      w = 0
    for (const [n, k] of weights) {
      if (k === 0) continue
      const cw = (gridW - (n - 1) * L.gap) / n
      const ch = cw * aspect + TEXT_H
      x += k * ((i % n) * (cw + L.gap))
      y += k * (Math.floor(i / n) * (ch + L.gap + 6))
      w += k * cw
    }
    // Cards that change rows lift over the others on the way (a soft shadow), like a FLIP move.
    const transit = (rowOf(i, 3) !== rowOf(i, 2) ? Math.sin(Math.PI * L.two) : 0) + (rowOf(i, 2) !== rowOf(i, 1) ? Math.sin(Math.PI * L.one) : 0)
    return { x, y, w, img: w * aspect, transit }
  })

  return (
    <div className="relative overflow-hidden font-sans" style={{ width: vw, height: PAGE_H, background: PAPER, color: INK }}>
      {/* Announcement bar */}
      <div className="flex items-center justify-center overflow-hidden px-4 text-[12px] font-medium whitespace-nowrap" style={{ height: BAR_H, background: INK, color: PAPER }}>
        Free UK delivery over £30
        <span className="inline-block overflow-hidden" style={{ maxWidth: (1 - L.menu) * 260, opacity: 1 - L.menu }}>
          &nbsp;· Roasted every Tuesday in Hackney
        </span>
      </div>

      {/* Header */}
      <div className="relative border-b" style={{ height: HEAD_H, borderColor: `${INK}1f` }}>
        <span className="absolute top-1/2 grid size-8 place-items-center" style={{ left: L.pad, opacity: settle, transform: `translate(${(1 - settle) * -8}px, -50%)` }}>
          {menu > 0.5 ? <X className="size-[22px]" strokeWidth={1.75} /> : <Menu className="size-[22px]" strokeWidth={1.75} />}
        </span>
        <span className="absolute top-1/2 flex w-[104px] -translate-y-1/2 items-center gap-2" style={{ left: logoX }}>
          <HalcyonMark size={26} color={PAPER} bg={INK} />
          <span className="text-[19px] font-semibold tracking-[-0.02em]">halcyon</span>
        </span>
        <span
          className="absolute top-1/2 flex text-[14px] font-medium whitespace-nowrap"
          style={{ left: L.pad + 104 + fluid(vw, [[768, 32], [1280, 56]]), gap: fluid(vw, [[768, 20], [1280, 30]]), opacity: 1 - linksOut, transform: `translate(${linksOut * -12}px, -50%)` }}
        >
          {NAV.map((n, i) => (
            <span key={n} className={i === 0 ? "underline decoration-2 underline-offset-[6px]" : "opacity-75"} style={i === 0 ? { textDecorationColor: ACCENT } : undefined}>
              {n}
            </span>
          ))}
        </span>
        <span className="absolute top-1/2 flex -translate-y-1/2 items-center gap-3" style={{ right: L.pad }}>
          <Search className="size-[18px]" strokeWidth={1.9} />
          <span className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold" style={{ background: INK, color: PAPER }}>
            <ShoppingBag className="size-[15px]" strokeWidth={2} />2
          </span>
        </span>
      </div>

      {/* Hero: wraps as the browser wraps it; what's under it eases to its height */}
      <div className={cn("relative", ease && "transition-[height] duration-[450ms] ease-[cubic-bezier(.22,1,.36,1)]")} style={{ height: heroH }}>
        <div ref={heroRef} style={{ paddingInline: L.pad, paddingTop: fluid(vw, [[390, 24], [1280, 34]]), paddingBottom: fluid(vw, [[390, 22], [1280, 28]]) }}>
          <div className="text-[12px] font-semibold tracking-[0.1em] uppercase opacity-55">Coffee · Single origins · 9</div>
          <h1 className="mt-2.5 max-w-[22em] font-serif leading-[1.04] tracking-[-0.015em] text-balance" style={{ fontSize: L.h1 }}>
            Roasted on Tuesday, in your cup by Friday.
          </h1>
          <p className="mt-3 max-w-[500px] leading-[1.5] opacity-75" style={{ fontSize: fluid(vw, [[390, 14], [1280, 15.5]]) }}>
            Small lots we buy direct from nine farms and roast in Hackney each week. Every bag is stamped with its roast date.
          </p>
        </div>
      </div>

      {/* Shop: sidebar or chip bar, and the grid */}
      <div className="relative">
        {L.side < 1 && (
          <div className="absolute top-1" style={{ left: L.pad, width: SIDE_W, opacity: 1 - Math.min(1, L.side * 1.6), transform: `translateX(${L.side * -24}px)` }}>
            <Sidebar />
          </div>
        )}
        {L.side > 0 && (
          <div className="absolute top-0" style={{ left: L.pad, width: vw - 2 * L.pad, height: FILTER_H, opacity: L.side, transform: `translateY(${(1 - L.side) * -10}px)` }}>
            <FilterBar />
          </div>
        )}
        {cards.map((r, i) => (
          <div
            key={i}
            className="absolute"
            style={{ left: gridX + r.x, top: gridY + r.y, width: r.w, height: r.img + TEXT_H, zIndex: r.transit > 0 ? 2 : 1 }}
          >
            <Card c={COFFEES[i]} w={r.w} img={r.img} lift={Math.min(1, r.transit)} />
          </div>
        ))}
      </div>

      <MenuSheet p={menu} />
    </div>
  )
}
