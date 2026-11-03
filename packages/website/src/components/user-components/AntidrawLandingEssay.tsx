/**
 * Antidraw's landing page as a short essay, after superlogical.com: one size
 * of type throughout, paragraphs on the left, quiet gray labels between
 * them and a numbered list. At the top, the logo and the download button,
 * then the title and two paragraphs.
 */
import { useEffect, useState, type ReactNode } from "react"
import { PATHS } from "./antidraw-empty/logos"
import { PM_FIGS } from "./parts/PMDiagrams"
import { LogoGrid } from "./parts/LibraryLogosGrid"
import { UseCasesRows } from "./landing/UseCases"
import { UnlockTickerSection } from "./landing/UnlockTicker"
import { FLOW_STAGES, FlowAurora } from "./landing/FlowAurora"
import { HERO_SIZE } from "./landing/HeroSize"
import { LandingFontFaces, fontStack } from "./landing/LandingFonts"
import { NAV_H } from "./landing/EssayNav"
import { CanvasLanding } from "./AntidrawLandingCanvas"
import { COMPANY_LIBS, OPEN_LIBS } from "./libraries/catalog"

const RELEASES = "https://github.com/AntidrawHQ/antidraw/releases"
const REPO = "https://github.com/AntidrawHQ/antidraw"


const AppleMark = ({ className = "size-[14px]" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M16.37 12.68c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.65ZM14.1 5.92c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.01.08 2.05-.52 2.69-1.28Z" />
  </svg>
)

const GithubMark = ({ className = "size-[14px]" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d={PATHS.github.d} />
  </svg>
)

const Label = ({ children }: { children: ReactNode }) => <h2 className="mt-24 mb-6 text-[#8a8a8a]">{children}</h2>

// Use cases by role, starting with product managers.
const PM = [
  "Bring five takes to the review, not one idea.",
  "Settle “inline or its own page?” by building both.",
  "Start from a screenshot of the real page, so it looks like your product.",
  "Turn a PRD into a flow you can click, with the gaps it left listed.",
  "Show a customer their request working, on the next call.",
]

const MAKE = [
  "A change to a real screen, from a screenshot.",
  "A clickable prototype, from a PRD.",
  "A video for your feature, storyboarded scene by scene.",
  "A slide deck, in three directions.",
  "A mockup for a sales call, in the prospect's colours.",
]

const DO = [
  "Ask for three directions and compare them side by side.",
  "Point at an element and Claude gets the exact line.",
  "Pin comments on frames, then send them together.",
  "Nudge spacing, colour and type by hand, written back as code.",
  "Publish a link, or hand your developer the folder.",
]

const List = ({ items }: { items: string[] }) => (
  <ol className="flex flex-col gap-2.5">
    {items.map((t, i) => (
      <li key={t} className="flex gap-5">
        <span className="w-4 shrink-0 text-[#6f6f6f] tabular-nums">{i + 1}</span>
        <span>{t}</span>
      </li>
    ))}
  </ol>
)

// A numbered list with a line diagram beside each item.
const FigList = ({ items, figs }: { items: string[]; figs: (() => ReactNode)[] }) => (
  <ol className="flex flex-col gap-4">
    {items.map((t, i) => {
      const Fig = figs[i]
      return (
        <li key={t} className="flex items-center gap-5">
          <span className="flex flex-1 gap-5">
            <span className="w-4 shrink-0 text-[#6f6f6f] tabular-nums">{i + 1}</span>
            <span>{t}</span>
          </span>
          <span className="hidden h-[116px] w-[186px] shrink-0 rounded-[10px] border border-white/[0.08] bg-[#222] sm:block">
            <Fig />
          </span>
        </li>
      )
    })}
  </ol>
)

const Buttons = () => (
  <div className="mt-10 flex flex-wrap gap-2">
    <a
      href={RELEASES}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-[14px] font-medium tracking-normal text-[#171717] transition-transform active:scale-[0.97]"
    >
      <AppleMark />
      Download for Mac
    </a>
    <a
      href={REPO}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-4 text-[14px] font-medium tracking-normal text-white transition-colors hover:bg-white/10"
    >
      <GithubMark />
      Star on GitHub
    </a>
  </div>
)

/** The essay after its headline: shared with the other landing pages. */
export const EssayBody = () => (
  <>
    <div className="flex flex-col gap-6">
      <p>
        Antidraw is an infinite canvas that lets you prototype and design your products with your coding agents. You make actual working designs and
        prototypes instead of static, lifeless rectangles.
      </p>
      <p>
        Real code, real interactions, real flows, real animations. Nothing needs a workaround: you work in the same medium that gets shipped, with the same
        libraries your engineers use to make things.
      </p>
      <p>
        We want to give the power of the entire coding ecosystem to designers and non-technical people: marketers, sales folks, product managers. Everyone
        in a company should be prototyping and exploring in code, and every asset that can be made in code will be. Without losing your craft to soulless,
        one-shotted outputs: you need a visual medium to iterate on visual work, and Antidraw becomes that canvas for your team.
      </p>
      <p>
        For years, interfaces were needed to get around the fact that writing code is expensive. Coding agents change that. You don't need another
        in-between medium to express your ideas anymore; you can ask your agents to bring them to life in code. Antidraw is the canvas that helps you explore
        multiple directions, fine-tune and make precise edits, and bring your ideas to life quickly and as a whole.
      </p>
    </div>

    <Label>If you're a product manager</Label>
    <FigList items={PM} figs={PM_FIGS} />

    <Label>On the canvas</Label>
    <List items={DO} />

    <Label>What people make</Label>
    <List items={MAKE} />

    <Label>What it works with</Label>
    <p>
      Any React library on npm: shadcn/ui, Material UI, Carbon, Polaris, Kumo, Motion, Remotion, Recharts, or your company's own, from a private registry
      or a GitHub repo.
    </p>

    <Label>Get it</Label>
    <p>Free and open source, for Macs with Apple Silicon or Intel. It runs Claude Code on your machine, with your own Claude account.</p>
    <Buttons />
  </>
)

// The page in each theme.
const TONES = {
  dark: {
    page: "bg-[#262626] text-[#f2f2f2]",
    ink: "text-white",
    soft: "text-white/70",
    note: "text-white/85",
    ghost: "border-white/15 bg-white/5 text-white hover:bg-white/10",
    solid: "bg-white text-[#171717]",
    footer: "text-[#6f6f6f]",
  },
  light: {
    page: "bg-[#f5f5f4] text-[#171717]",
    ink: "text-[#171717]",
    soft: "text-black/60",
    note: "text-black/75",
    ghost: "border-black/15 bg-black/[0.03] text-[#171717] hover:bg-black/[0.06]",
    solid: "bg-[#171717] text-white",
    footer: "text-[#8a8a8a]",
  },
}

/**
 * The canvas hero, mounted in the browser only: it sizes itself from the window on its first render,
 * which the server can't do. Until then, an empty screen of the same height and ground holds its place.
 */
function CanvasHero({ theme }: { theme: "dark" | "light" }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted ? <CanvasLanding theme={theme} /> : <div className={`h-screen min-h-[680px] ${theme === "dark" ? "bg-[#232323]" : "bg-[#f5f5f4]"}`} />
}

/**
 * The essay landing in either theme (AntidrawLandingEssayLight renders the light one). `band` is
 * what sets the tour apart: the glowing columns, the aurora from the first essay landing
 * (AntidrawLandingEssayAurora), or that aurora behind the whole page, flowing as you scroll
 * (AntidrawLandingEssayAuroraFlow; the sections carry data-flow markers for it).
 */
export function EssayLanding({ theme = "dark", band = "columns" }: { theme?: "dark" | "light"; band?: "columns" | "aurora" | "flow" }) {
  const t = TONES[theme]
  const stages = FLOW_STAGES
  const hero = HERO_SIZE
  return (
    <div className={`relative isolate min-h-screen antialiased ${t.page}`} style={{ fontFamily: fontStack(hero.font) }}>
      {band === "flow" && <FlowAurora stages={stages} />}
      <LandingFontFaces />

      {/* The hero: Antidraw's own canvas, drifting, with agents at work and the title above (AntidrawLandingCanvas). It brings the fixed navbar. */}
      <div className="relative z-20">
        <CanvasHero theme={theme} />
      </div>

      <main className="relative z-10 px-8 pb-24 sm:px-16">
        {/* Open-source component libraries, as a logo grid. */}
        <section data-flow="libs" className="mx-auto mt-[200px] max-w-[1000px]">
          <h2 className={`mb-6 text-[30px] leading-[1.12] font-medium tracking-[-0.028em] sm:text-[36px] ${t.ink}`} style={{ fontVariationSettings: '"opsz" 32' }}>
            bring your favourite
            <br />
            component library.
          </h2>
          <p className={`max-w-[620px] text-[18px] leading-[1.55] tracking-[-0.01em] text-pretty sm:text-[20px] ${t.soft}`}>
            shadcn/ui, Radix, Ark UI, React Aria, Mantine, Material UI. Install it, ask for it, and it's on the canvas, working.
          </p>
        </section>
        <LogoGrid libs={OPEN_LIBS} theme={theme} size="lg" className="mx-auto mt-20 max-w-[1000px]" />

        {/* Company design systems, the same way. */}
        <section data-flow="companies" className="mx-auto mt-[200px] max-w-[1000px]">
          <h2 className={`mb-6 text-[30px] leading-[1.12] font-medium tracking-[-0.028em] sm:text-[36px] ${t.ink}`} style={{ fontVariationSettings: '"opsz" 32' }}>
            build like your favourite companies,
            <br />
            with their own components.
          </h2>
          <p className={`max-w-[620px] text-[18px] leading-[1.55] tracking-[-0.01em] text-pretty sm:text-[20px] ${t.soft}`}>
            Kumo from Cloudflare, Fluent from Microsoft, Polaris from Shopify, Primer from GitHub. Or your company's own, from a private registry.
          </p>
        </section>
        <LogoGrid libs={COMPANY_LIBS} theme={theme} size="lg" className="mx-auto mt-20 max-w-[1000px]" />

        {/* Any library, what it makes: the Split ticker from LandingUnlocks (landing/Unlocks' Ticker). */}
        <UnlockTickerSection style="split" theme={theme} className="mx-auto mt-[200px] max-w-[1000px]" />

        {/* Who it's for: a sticky role index, then one row per use case that stacks as you scroll (landing/UseCases.tsx). */}
        <div data-flow="usecases">
          <UseCasesRows theme={theme} pin={NAV_H + 16} className="mt-[200px]" />
        </div>

        <footer data-flow="footer" className={`mx-auto mt-32 max-w-[1000px] text-[15px] ${t.footer}`}>© 2026 Antidraw · MIT licensed</footer>
      </main>
    </div>
  )
}

export default function AntidrawLandingEssay() {
  return <EssayLanding />
}
