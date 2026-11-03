/**
 * What follows the canvas landing's first screen (AntidrawLandingCanvas's CanvasHero): the essay landing's
 * sections (landing/EssaySections), then the footer in `footer`'s style (landing/Footers). A module of its
 * own, so the hero's code never waits on theirs.
 */
import { EssaySections, type SectionsPart } from "./EssaySections"
import { LandingFooter, type FooterStyle } from "./Footers"
import { TypeScaleCtx } from "./TypeScale"

type Theme = "dark" | "light"

/** The sections, or one `part` of them. Set against the hero's 32px title: no heading below outgrows it. */
export function CanvasSections({ theme = "dark", part }: { theme?: Theme; part?: SectionsPart }) {
  return (
    <TypeScaleCtx.Provider value="compact">
      <EssaySections theme={theme} first="mt-16 sm:mt-24" part={part} />
    </TypeScaleCtx.Provider>
  )
}

export function CanvasFooter({ theme = "dark", footer = "closeColumns" }: { theme?: Theme; footer?: FooterStyle }) {
  return (
    <TypeScaleCtx.Provider value="compact">
      <LandingFooter style={footer} theme={theme} className="mt-32" />
    </TypeScaleCtx.Provider>
  )
}
