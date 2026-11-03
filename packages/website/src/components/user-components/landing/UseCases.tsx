/**
 * The landing's use-case section, as a filmstrip (layout 5 of
 * LandingUseCasesLayouts): a heading and a paragraph in the 600px text
 * column, then one sideways row of large captioned video cards per role,
 * starting at the page's left padding (in line with the logo) and running
 * off the window's right edge. Finished videos play; the rest are labelled placeholders
 * until they're made. Each card is a colour with a halftone border and a
 * little grain, the video inset in a dark window. Styled to sit inside AntidrawLandingEssay's <main>
 * (its px-5 / sm:px-16 padding) in either theme.
 */
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"

import { cn } from "@/lib/utils"
import { useType } from "./TypeScale"
import { UseCasePMPrdTakesScene } from "../scenes/UseCasePMPrdTakes"
import { UseCasePMClickFlowsScene } from "../scenes/UseCasePMClickFlows"
import { UseCasePMRealDataScene } from "../scenes/UseCasePMRealData"
import { UseCasePMUserTestsScene } from "../scenes/UseCasePMUserTests"
import { UseCaseDesignAnimationsScene } from "../scenes/UseCaseDesignAnimations"
import { UseCaseDesignControlsScene } from "../scenes/UseCaseDesignControls"
import { UseCaseDesignStatesScene } from "../scenes/UseCaseDesignStates"
import { UseCaseDesignResponsiveScene } from "../scenes/UseCaseDesignResponsive"
import { UseCaseMarketingVideoScene } from "../scenes/UseCaseMarketingVideo"
import { UseCaseMarketingSlidesScene } from "../scenes/UseCaseMarketingSlides"
import { UseCaseMarketingSizesScene } from "../scenes/UseCaseMarketingSizes"
import { UseCaseSalesMockupScene } from "../scenes/UseCaseSalesMockup"

export type UseCase = { title: string; line: string; Scene?: ComponentType<{ className?: string }> }
type Role = { role: string; pitch: string; cases: UseCase[] }

export const USE_CASE_ROLES: Role[] = [
  {
    role: "PMs",
    pitch: "Make prototypes and wireframes people can actually use and share. Explore directions until you find the right one, at AI-native speed.",
    cases: [
      { title: "Several takes on one PRD", line: "Hand it the PRD and ask for three takes. Each one is built from the components your team already ships, so every option on the table is one engineering could actually build.", Scene: UseCasePMPrdTakesScene },
      { title: "Real flows you can click through", line: "Screens that link up, with the transitions, loading states and small interactions in place. Walk a stakeholder through the real thing instead of narrating a slide.", Scene: UseCasePMClickFlowsScene },
      { title: "Real data, real logic", line: "Drop in a spreadsheet or a sample of real data, and give the prototype logic a picture can't fake: sorting, filtering, search, totals, pricing maths. Your numbers and edge cases, not lorem ipsum.", Scene: UseCasePMRealDataScene },
      { title: "Test it with users", line: "Run research sessions on a prototype that behaves like the product. Testers click through the real flow while you watch, and you can change it between sessions.", Scene: UseCasePMUserTestsScene },
    ],
  },
  {
    role: "Designers",
    pitch: "Design in the material the product is made of.",
    cases: [
      { title: "Animations other tools can't do", line: "Springs, gestures, scroll, drag and physics you can actually feel, not a prototype link that fakes it with dissolves. Tune the motion on the real component until it's right.", Scene: UseCaseDesignAnimationsScene },
      { title: "Build the controls you need", line: "Ask for the exact sliders, swatches and toggles a design needs, then shape it by hand. When AI can make almost anything, the craft is in having the right handles.", Scene: UseCaseDesignControlsScene },
      { title: "Design every state", line: "Hover, loading, empty, error, the 40-character name and the three-line title. Flip through them on the real component instead of drawing each one.", Scene: UseCaseDesignStatesScene },
      { title: "Responsive for real", line: "Resize the frame and the layout reflows the way it will in the browser. No more drawing a mobile, tablet and desktop copy of every screen.", Scene: UseCaseDesignResponsiveScene },
    ],
  },
  {
    role: "Marketers",
    pitch: "On-brand assets from the real product, with every detail yours to adjust.",
    cases: [
      { title: "Launch videos with Remotion", line: "Feature announcements made from your real components and brand, scene by scene. The product in the video is the product people get, and every frame is yours to adjust.", Scene: UseCaseMarketingVideoScene },
      { title: "Slides made of real components", line: "Launch keynotes and webinar decks built from your actual product and brand. Animated where you want it, and never out of date with the app.", Scene: UseCaseMarketingSlidesScene },
      { title: "Every size, from one design", line: "Because it's code, one design adapts. Ask for the square, the story and the banner, and each one lays itself out properly instead of being redrawn.", Scene: UseCaseMarketingSizesScene },
    ],
  },
  {
    role: "Sales",
    pitch: "Show prospects the product they're buying, shaped around them.",
    cases: [
      { title: "Mockups with their data", line: "Their logo, their colours and their records, inside your product. Show a prospect what it looks like when it's theirs, before they've signed anything.", Scene: UseCaseSalesMockupScene },
    ],
  },
]

const TONE = {
  dark: { ink: "text-white", soft: "text-white/70", quiet: "text-white/45" },
  light: { ink: "text-[#171717]", soft: "text-black/60", quiet: "text-black/45" },
}

/* ── The card's frame: a colour, a halftone border, grain ───────────── */

/** Each card's colour and the lighter tint its pattern is drawn in. */
export const SWATCHES: [string, string][] = [
  ["#a8c0b1", "#d6fbff"], // sage
  ["#f2d7a2", "#fff6dc"], // peach
  ["#c3bcf0", "#f3f0ff"], // lavender
  ["#a6d0ea", "#eaf8ff"], // sky
  ["#eeb6ae", "#fff1ec"], // rose
  ["#cde197", "#f8ffdc"], // lime
  ["#e2ccb2", "#fcf4ea"], // sand
  ["#9ed6c2", "#e8fff7"], // mint
]

/** The frame's drawing size; the card keeps this ratio at any width (the inset is a % of the width). */
const FW = 760
const PAD = 0.036
const IW = FW * (1 - 2 * PAD)
const FH = Math.round(IW * (9 / 16) + 2 * PAD * FW)
const INSET = PAD * FW
/** Width over height of a card, at any size. */
export const FRAME_RATIO = FW / FH

const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

type Shape = { x: number; y: number; r: number; kind: 0 | 1 | 2; a: number }

/**
 * A halftone of dots, diamonds and dashes on a grid around the border:
 * a few soft clusters along the edges grow the shapes big, elsewhere they
 * stay small and sparse, and every cell is a little random.
 */
function halftone(seed: number): Shape[] {
  const step = 15
  const blobs = Array.from({ length: 4 }, (_, k) => {
    const side = Math.floor(rnd(seed * 31 + k) * 4)
    const t = rnd(seed * 17 + k * 7)
    const [x, y] = side === 0 ? [t * FW, INSET * 0.5] : side === 1 ? [FW - INSET * 0.5, t * FH] : side === 2 ? [t * FW, FH - INSET * 0.5] : [INSET * 0.5, t * FH]
    return { x, y, r: 40 + rnd(seed * 13 + k) * 50 }
  })
  const out: Shape[] = []
  for (let gy = step / 2; gy < FH; gy += step)
    for (let gx = step / 2; gx < FW; gx += step) {
      // Skip what the window covers.
      if (gx > INSET + 4 && gx < FW - INSET - 4 && gy > INSET + 4 && gy < FH - INSET - 4) continue
      const n = gx * 0.37 + gy * 1.91 + seed * 101
      const lump = Math.max(...blobs.map((b) => Math.exp(-((gx - b.x) ** 2 + (gy - b.y) ** 2) / (2 * b.r * b.r))))
      const v = lump * 0.95 + rnd(n) * 0.45 - 0.18
      if (v < 0.12 || rnd(n + 3) < 0.28 - lump * 0.25) continue
      const kind = (rnd(n + 7) < 0.45 ? 0 : rnd(n + 9) < 0.6 ? 1 : 2) as Shape["kind"]
      out.push({ x: gx, y: gy, r: Math.min(1, v) * step * 0.5, kind, a: rnd(n + 11) < 0.5 ? 45 : -45 })
    }
  return out
}

/** The colour pair of role ri's case ci, as its card draws it (the navbar's menus reuse it). */
export const cardSwatch = (ri: number, ci: number) => SWATCHES[(ri * 3 + ci) % SWATCHES.length]

function Frame({ i, children }: { i: number; children: ReactNode }) {
  const [bg, ink] = SWATCHES[i % SWATCHES.length]
  const shapes = useMemo(() => halftone(i + 1), [i])
  return (
    <div className="relative overflow-hidden" style={{ background: bg, padding: `${PAD * 100}%` }}>
      <svg aria-hidden className="absolute inset-0 h-full w-full" viewBox={`0 0 ${FW} ${FH}`} preserveAspectRatio="xMidYMid slice">
        <filter id="ucs-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1.6 -0.55" />
        </filter>
        <g fill={ink}>
          {shapes.map((s, k) =>
            s.kind === 0 ? (
              <circle key={k} cx={s.x} cy={s.y} r={s.r} />
            ) : s.kind === 1 ? (
              <rect key={k} x={s.x - s.r * 0.8} y={s.y - s.r * 0.8} width={s.r * 1.6} height={s.r * 1.6} transform={`rotate(45 ${s.x} ${s.y})`} />
            ) : (
              <rect key={k} x={s.x - s.r * 1.1} y={s.y - s.r * 0.42} width={s.r * 2.2} height={s.r * 0.84} rx={s.r * 0.2} transform={`rotate(${s.a} ${s.x} ${s.y})`} />
            ),
          )}
        </g>
        <rect width={FW} height={FH} filter="url(#ucs-grain)" opacity="0.35" />
      </svg>
      <div className="relative aspect-[16/9] overflow-hidden bg-[#262626] shadow-[0_10px_30px_-12px_rgba(0,0,0,0.45)] ring-1 ring-black/10">{children}</div>
    </div>
  )
}

type Tone = (typeof TONE)["dark"]

/** Hyphenated words ("AI-native") stay on one line instead of breaking at the hyphen. */
const keepHyphens = (text: string) => text.split(/(\S+-\S+)/).map((part, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part))

/** The section's heading and paragraph, in the 1000px column the demo and grids share. */
function Intro({ t }: { t: Tone }) {
  const ty = useType()
  return (
    <section className="mx-auto max-w-[1000px]">
      <h2 className={`font-medium ${ty.h2} ${t.ink}`} style={{ fontVariationSettings: '"opsz" 32' }}>
        made for the whole team,{" "}
        <br className="max-sm:hidden" />
        everyone with an idea to show.
      </h2>
      <p className={`max-w-[620px] text-pretty ${ty.para} ${t.soft}`}>
        PMs, designers, marketers and sales spend their days describing products to each other. With Antidraw they can show it, working.
      </p>
    </section>
  )
}

/** A use case's card: its colour frame, with the video or a placeholder until it's made. Neighbouring cards, and the same slot in the next role, never share a colour. */
export function Card({ uc, role, ri, ci }: { uc: UseCase; role: string; ri: number; ci: number }) {
  return (
    <Frame i={ri * 3 + ci}>
      {uc.Scene ? (
        <uc.Scene />
      ) : (
        <div className="grid h-full place-content-center text-center">
          <div className="text-[13px] font-medium text-white/45">
            {role} · {uc.title}
          </div>
          <div className="mt-1 text-[12px] text-white/25">Video to come</div>
        </div>
      )}
    </Frame>
  )
}

/** Layout: per role, a sideways filmstrip of cards starting at the page's left padding. */
export function UseCasesSection({ theme = "dark", className }: { theme?: "dark" | "light"; className?: string }) {
  const t = TONE[theme]
  return (
    <div className={className}>
      <Intro t={t} />
      <div className="mt-16 flex flex-col gap-14">
        {USE_CASE_ROLES.map((r, ri) => (
          <div key={r.role}>
            <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className={`text-[19px] font-medium ${t.ink}`}>{r.role}</span>
              <span className={`text-[14px] ${t.quiet}`}>{r.pitch}</span>
            </div>
            <div className="ucs-strip -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-5 overflow-x-auto px-5 pb-3 sm:-mx-16 sm:scroll-px-16 sm:px-16">
              {r.cases.map((uc, ci) => (
                <div key={uc.title} className="w-[min(760px,86vw)] shrink-0 snap-start">
                  <Card uc={uc} role={r.role} ri={ri} ci={ci} />
                  <div className={`mt-3.5 text-[16px] font-medium ${t.ink}`}>{uc.title}</div>
                  <div className={`mt-1 text-[14px] leading-[1.5] ${t.quiet}`}>{uc.line}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <style>{`.ucs-strip { scrollbar-width: none } .ucs-strip::-webkit-scrollbar { display: none }`}</style>
    </div>
  )
}

/** Each row needs the page's own colour so the next one covers it cleanly. */
/** The rows' ground, opaque so the next slides over it: the page's own (its --landing-page), else the essay's. */
const PAGE = { dark: "bg-[var(--landing-page,#262626)]", light: "bg-[var(--landing-page,#f5f5f4)]" }
/** Rows pin this far from the top of the window, each a little lower than the last, so the next one slides up over it like a sheet on a stack. */
const PIN = 32
const FOLDED = 18

/**
 * Layout, after Morph's site: a sticky index of roles on the left (square
 * bullets, the one you're reading lit), and on the right one row per use
 * case, text on the left and its card on the right. Each role opens with its name and pitch.
 *
 * Scrolling stacks the rows: within a role each one pins near the top and
 * the next slides up over it, so the ones you've read fold down to their
 * titles, dimmed and pushed back a little.
 */
/** `pin` is how far below the top rows stick (more under a fixed navbar); roles and rows carry ids #role-n and #uc-n-m for links. */
export function UseCasesRows({ theme = "dark", className, roles = USE_CASE_ROLES, intro = true, pin = PIN }: { theme?: "dark" | "light"; className?: string; roles?: Role[]; intro?: boolean; pin?: number }) {
  const t = TONE[theme]
  const ty = useType()
  const refs = useRef<(HTMLElement | null)[]>([])
  const [active, setActive] = useState(0)
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.role))
      },
      { rootMargin: "-35% 0px -60% 0px" },
    )
    refs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  // How far the next row has slid over each row (0 open → 1 folded), written straight to the row's style.
  const rows = useRef<(HTMLDivElement | null)[][]>([])
  useEffect(() => {
    let raf = 0
    const update = () => {
      raf = 0
      for (const group of rows.current) {
        group.forEach((el, k) => {
          const next = group[k + 1]
          if (!el) return
          const inner = el.firstElementChild as HTMLElement | null
          let cover = 0
          if (next) {
            const a = el.getBoundingClientRect()
            const b = next.getBoundingClientRect()
            cover = Math.min(1, Math.max(0, (a.bottom - b.top) / Math.max(1, a.height - FOLDED)))
          }
          if (inner) {
            inner.style.opacity = String(1 - cover * 0.55)
            inner.style.transform = `scale(${1 - cover * 0.03})`
          }
        })
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])
  return (
    <div className={className}>
      {intro && <Intro t={t} />}
      <div className={cn("grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)]", intro && "mt-16 sm:mt-28")}>
        <nav className="sticky hidden flex-col gap-4 self-start lg:flex" style={{ top: pin + 8 }}>
          {roles.map((r, ri) => (
            <button
              key={r.role}
              type="button"
              onClick={() => refs.current[ri]?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className={cn("flex items-center gap-3 text-left text-[15px] font-medium tracking-[0.08em] uppercase transition-colors", active === ri ? t.ink : t.quiet)}
            >
              <span className={cn("size-2 transition-colors", active === ri ? "bg-current" : "bg-current opacity-40")} />
              {r.role}
            </button>
          ))}
        </nav>
        <div>
          {roles.map((r, ri) => (
            <section
              key={r.role}
              data-role={ri}
              ref={(el) => {
                refs.current[ri] = el
              }}
              id={`role-${ri}`}
              style={{ scrollMarginTop: pin }}
            >
              <div className="pt-10 pb-6">
                <div className={`leading-[1.1] font-medium tracking-[-0.025em] ${ty.role} ${t.ink}`}>{r.role}</div>
                <p className={`m-0 mt-3 max-w-[560px] ${ty.pitch} leading-[1.5] tracking-[-0.005em] text-pretty ${t.quiet}`}>{keepHyphens(r.pitch)}</p>
              </div>
              {/* The stack: each row pins a title's height below the last; the room at the end holds the final row before the role scrolls away. */}
              <div className="pb-[18vh]">
                {r.cases.map((uc, ci) => (
                  <div
                    key={uc.title}
                    id={`uc-${ri}-${ci}`}
                    ref={(el) => {
                      ;(rows.current[ri] ??= [])[ci] = el
                    }}
                    className={`md:sticky ${PAGE[theme]}`}
                    style={{ top: pin + ci * FOLDED, zIndex: ci + 1, scrollMarginTop: pin + ci * FOLDED }}
                  >
                    {/* The words on top, the video as wide as the column below; capped by the screen's height so a pinned row always fits. */}
                    <div className="origin-top py-8 will-change-transform">
                      <div className="max-w-[560px]">
                        <div className={`leading-[1.2] font-medium tracking-[-0.018em] ${ty.case} ${t.ink}`}>{uc.title}</div>
                        <p className={`m-0 mt-2 ${ty.line} leading-[1.55] text-pretty ${t.soft}`}>{uc.line}</p>
                      </div>
                      <div className="mt-6" style={{ width: `min(100%, calc((100vh - 280px) * ${FRAME_RATIO}))` }}>
                        <Card uc={uc} role={r.role} ri={ri} ci={ci} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
