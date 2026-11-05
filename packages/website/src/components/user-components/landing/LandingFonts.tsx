/**
 * Typefaces to try on the essay landing, all free to self-host (SIL Open Font License, variable
 * weight, Latin subsets from Fontsource in landing/fonts), plus Inter, Geist and the system's
 * SF Pro. The landing is set in Schibsted Grotesk. Figma's own "figmaSans" is theirs alone, so
 * these are the closest open relatives: grotesques with a little character.
 *
 * <LandingFontFaces /> declares them all; a browser only downloads the one a page actually uses.
 */
import interUrl from "./InterVariable.woff2?url"
import geistUrl from "../antidraw-empty/Geist-Variable.woff2?url"
import monaUrl from "./fonts/mona-sans.woff2?url"
import instrumentUrl from "./fonts/instrument-sans.woff2?url"
import hankenUrl from "./fonts/hanken-grotesk.woff2?url"
import schibstedUrl from "./fonts/schibsted-grotesk.woff2?url"
import bricolageUrl from "./fonts/bricolage-grotesque.woff2?url"
import onestUrl from "./fonts/onest.woff2?url"
import figtreeUrl from "./fonts/figtree.woff2?url"
import interTightUrl from "./fonts/inter-tight.woff2?url"
import manropeUrl from "./fonts/manrope.woff2?url"
import jakartaUrl from "./fonts/plus-jakarta-sans.woff2?url"

export type LandingFont = { id: string; name: string; family: string; url?: string; note: string }

const FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

export const LANDING_FONTS: LandingFont[] = [
  { id: "inter", name: "Inter", family: "Inter Variable", url: interUrl, note: "Neutral, built for screens" },
  { id: "sf", name: "SF Pro", family: "", note: "The Mac's own, and Figma's fallback" },
  { id: "geist", name: "Geist", family: "Geist Variable", url: geistUrl, note: "Vercel's: crisp, Swiss, a touch technical" },
  { id: "mona", name: "Mona Sans", family: "Mona Sans Variable", url: monaUrl, note: "GitHub's: strong, slightly wide grotesque" },
  { id: "instrument", name: "Instrument Sans", family: "Instrument Sans Variable", url: instrumentUrl, note: "Clean with a little warmth; close to Figma Sans in feel" },
  { id: "inter-tight", name: "Inter Tight", family: "Inter Tight Variable", url: interTightUrl, note: "Inter spaced for display: punchier headlines" },
  { id: "hanken", name: "Hanken Grotesk", family: "Hanken Grotesk Variable", url: hankenUrl, note: "Friendly, open grotesque" },
  { id: "schibsted", name: "Schibsted Grotesk", family: "Schibsted Grotesk Variable", url: schibstedUrl, note: "The landing's: editorial, newspaper-born, confident" },
  { id: "bricolage", name: "Bricolage Grotesque", family: "Bricolage Grotesque Variable", url: bricolageUrl, note: "Quirky ink-trap grotesque; the most character" },
  { id: "onest", name: "Onest", family: "Onest Variable", url: onestUrl, note: "Soft, rounded-feeling, very readable" },
  { id: "figtree", name: "Figtree", family: "Figtree Variable", url: figtreeUrl, note: "Geometric and friendly" },
  { id: "manrope", name: "Manrope", family: "Manrope Variable", url: manropeUrl, note: "Modern semi-condensed geometric" },
  { id: "jakarta", name: "Plus Jakarta Sans", family: "Plus Jakarta Sans Variable", url: jakartaUrl, note: "Contemporary, slightly rounded" },
]

/** The CSS font-family stack for a font id. */
export const fontStack = (id: string) => {
  const f = LANDING_FONTS.find((x) => x.id === id) ?? LANDING_FONTS[0]
  return f.family ? `"${f.family}", ${FALLBACK}` : FALLBACK
}

export function LandingFontFaces() {
  const css = LANDING_FONTS.filter((f) => f.url)
    .map((f) => `@font-face { font-family: "${f.family}"; src: url("${f.url}") format("woff2"); font-weight: 100 900; font-display: swap; }`)
    .join("\n")
  return <style>{css}</style>
}
