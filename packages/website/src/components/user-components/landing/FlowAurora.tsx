/**
 * One aurora behind a whole page, driven by scroll: it waits behind the demo at the top, climbs
 * and spreads up the screen as you scroll through the library sections while its colours drift
 * (Mars → rose → lavender), then gathers into the left margin for the use cases (their stacking
 * rows are opaque, the role index beside them isn't) and takes each role's colour as you reach it.
 * Scrolling also speeds the curtains up, so the light flows with you and settles when you stop.
 *
 * Each stage is keyed to an element: its top crossing the middle of the screen completes the move
 * into that stage. The page marks its sections with data-flow="libs | companies | usecases | footer";
 * the roles are UseCasesRows' own section[data-role].
 */
import { useEffect, useRef, useState } from "react"

import { Aurora } from "../parts/Aurora"

/** `side` 0 lets the light fill the screen; 1 gathers it into the left margin, beside the role index. */
export type FlowStage = { name: string; at: string; colors: [string, string, string]; height: number; spread: number; intensity: number; side: number }

/** The stages, in page order. `at` is the element that, reaching mid-screen, completes the move into this stage. */
export const FLOW_STAGES: FlowStage[] = [
  { name: "Hero", at: "top", colors: ["#ff4d2e", "#ff9e3d", "#ffd27a"], height: 0.38, spread: 1, intensity: 1, side: 0 },
  { name: "Libraries", at: '[data-flow="libs"]', colors: ["#ff7a59", "#ff6a88", "#ffb36b"], height: 0.62, spread: 1.5, intensity: 0.85, side: 0 },
  { name: "Companies", at: '[data-flow="companies"]', colors: ["#ff8fab", "#c77dff", "#8e7dff"], height: 0.82, spread: 1.8, intensity: 0.7, side: 0 },
  // The use cases: the light pools in the left margin, one colour per role.
  { name: "PMs", at: '[data-flow="usecases"] section[data-role="0"]', colors: ["#ff4d2e", "#ff9e3d", "#ffd27a"], height: 0.3, spread: 1.2, intensity: 1, side: 1 },
  { name: "Designers", at: '[data-flow="usecases"] section[data-role="1"]', colors: ["#8e7dff", "#5b8cff", "#c9b8ff"], height: 0.42, spread: 1.3, intensity: 1, side: 1 },
  { name: "Marketers", at: '[data-flow="usecases"] section[data-role="2"]', colors: ["#ff6a88", "#ff8fab", "#ffb36b"], height: 0.36, spread: 1.3, intensity: 1, side: 1 },
  { name: "Sales", at: '[data-flow="usecases"] section[data-role="3"]', colors: ["#14b8a6", "#3ee07a", "#7fd3ff"], height: 0.4, spread: 1.2, intensity: 1, side: 1 },
  { name: "Footer", at: '[data-flow="footer"]', colors: ["#ff4d2e", "#ff9e3d", "#ffd27a"], height: 0.2, spread: 1, intensity: 0.9, side: 1 },
]
/** Where the gathered light ends: fully lit to here, gone by the content column (the essay's 64px gutter + 200px index + 40px gap). */
const SIDE_SOLID = 140
const SIDE_EDGE = 290

/** A colour as RGB; a half-typed hex from the panel reads as white (no light) until it's complete. */
const hex = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : [255, 255, 255])
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`
const mix = (a: number, b: number, p: number) => a + (b - a) * p
const smooth = (p: number) => p * p * (3 - 2 * p)

/** A left-to-right mask that slides in from past the right edge (side 0) to the margin (side 1). */
function sideMask(side: number) {
  if (side <= 0.001) return "none"
  const w = window.innerWidth
  const solid = Math.round(mix(w + 200, SIDE_SOLID, smooth(side)))
  const edge = Math.round(mix(w + 600, SIDE_EDGE, smooth(side)))
  return `linear-gradient(90deg, #000 0px, #000 ${solid}px, transparent ${edge}px)`
}

/** Where between stages the page is: stage i fully reached when its marker's top hits mid-screen. */
function readStage(stages: FlowStage[]): { i: number; p: number } {
  const mid = window.innerHeight * 0.5
  const tops = stages.map((s) => {
    if (s.at === "top") return -Infinity
    const el = document.querySelector<HTMLElement>(s.at)
    return el ? el.getBoundingClientRect().top - mid : Infinity
  })
  // The move into stage i runs over the screen-height before its marker reaches the middle.
  const span = window.innerHeight * 0.9
  for (let i = stages.length - 1; i > 0; i--) {
    const d = tops[i]
    if (d <= 0) return { i, p: 0 }
    if (d < span) return { i: i - 1, p: smooth(1 - d / span) }
  }
  return { i: 0, p: 0 }
}

/** `stages` overrides the look of each stage (the tuning panel edits them live). */
export function FlowAurora({ stages = FLOW_STAGES, className }: { stages?: FlowStage[]; className?: string }) {
  const [look, setLook] = useState(() => ({ colors: stages[0].colors as string[], height: stages[0].height, spread: stages[0].spread, intensity: stages[0].intensity, speed: 0.45, mask: "none" }))
  const velocity = useRef(0)
  const stagesRef = useRef(stages)
  stagesRef.current = stages

  useEffect(() => {
    let raf = 0
    let lastY = window.scrollY
    let lastT = performance.now()
    let boost = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const now = performance.now()
      const dt = Math.max(1, now - lastT)
      const y = window.scrollY
      // Scroll speed in px/s, eased, becomes extra drift: the curtains run while you scroll and settle after.
      velocity.current = Math.abs(y - lastY) / (dt / 1000)
      boost += (Math.min(2.2, velocity.current / 900) - boost) * 0.08
      lastY = y
      lastT = now

      const list = stagesRef.current
      const { i, p } = readStage(list)
      const a = list[i]
      const b = list[Math.min(list.length - 1, i + 1)]
      const colors = a.colors.map((c, k) => toHex(hex(c).map((v, j) => mix(v, hex(b.colors[k])[j], p))))
      const next = {
        colors,
        height: Math.round(mix(a.height, b.height, p) * 1000) / 1000,
        spread: Math.round(mix(a.spread, b.spread, p) * 100) / 100,
        intensity: Math.round(mix(a.intensity, b.intensity, p) * 100) / 100,
        speed: Math.round((0.45 + boost) * 100) / 100,
        mask: sideMask(mix(a.side, b.side, p)),
      }
      setLook((prev) =>
        prev.colors.join() === next.colors.join() &&
        prev.height === next.height &&
        prev.spread === next.spread &&
        prev.intensity === next.intensity &&
        prev.speed === next.speed &&
        prev.mask === next.mask
          ? prev
          : next,
      )
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <Aurora
      colors={look.colors}
      bands={4}
      speed={look.speed}
      intensity={look.intensity}
      height={look.height}
      spread={look.spread}
      rays={0}
      stars={false}
      theme="light"
      background={false}
      className={`pointer-events-none fixed inset-0 z-0 ${className ?? ""}`}
      style={{ maskImage: look.mask, WebkitMaskImage: look.mask }}
    />
  )
}
