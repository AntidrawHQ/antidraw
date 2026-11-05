/**
 * The essay landing's sections before the use cases: open-source libraries and company design systems as
 * logo grids, then the Split ticker of what any library makes. Its own module, so it loads without the use
 * cases' scenes (landing/EssaySections renders it, then the use cases).
 */
import { LogoGrid } from "../parts/LibraryLogosGrid"
import { COMPANY_LIBS, OPEN_LIBS } from "../libraries/catalog"
import { UnlockTickerSection } from "./UnlockTicker"
import { useType } from "./TypeScale"

const TONE = {
  dark: { ink: "text-white", soft: "text-white/70" },
  light: { ink: "text-[#171717]", soft: "text-black/60" },
}

/** `first`: the gap above the first section. */
export function EssayIntro({ theme, first }: { theme: "dark" | "light"; first: string }) {
  const t = TONE[theme]
  const ty = useType()
  return (
    <>
      {/* Open-source component libraries, as a logo grid. */}
      <section data-flow="libs" id="libraries" className={`mx-auto max-w-[1000px] ${first}`}>
        <h2 className={`font-medium ${ty.lead} ${t.ink}`} style={{ fontVariationSettings: '"opsz" 32' }}>
          bring your favourite{" "}
          <br className="max-sm:hidden" />
          component library.
        </h2>
        <p className={`max-w-[620px] text-pretty ${ty.para} ${t.soft}`}>
          shadcn/ui, Radix, Ark UI, React Aria, Mantine, Material UI. Install it, ask for it, and it's on the canvas, working.
        </p>
      </section>
      <LogoGrid libs={OPEN_LIBS} theme={theme} size="lg" className="mx-auto mt-12 max-w-[1000px] sm:mt-20" />

      {/* Company design systems, the same way. */}
      <section data-flow="companies" id="design-systems" className="mx-auto mt-28 max-w-[1000px] sm:mt-[200px]">
        <h2 className={`font-medium ${ty.h2} ${t.ink}`} style={{ fontVariationSettings: '"opsz" 32' }}>
          build like your favourite companies,{" "}
          <br className="max-sm:hidden" />
          with their own components.
        </h2>
        <p className={`max-w-[620px] text-pretty ${ty.para} ${t.soft}`}>
          Kumo from Cloudflare, Fluent from Microsoft, Polaris from Shopify, Primer from GitHub. Or your company's own, from a private registry.
        </p>
      </section>
      <LogoGrid libs={COMPANY_LIBS} theme={theme} size="lg" className="mx-auto mt-12 max-w-[1000px] sm:mt-20" />

      {/* Any library, what it makes: the Split ticker from LandingUnlocks (landing/Unlocks' Ticker). */}
      <UnlockTickerSection style="split" theme={theme} className="mx-auto mt-28 max-w-[1000px] sm:mt-[200px]" />
    </>
  )
}
