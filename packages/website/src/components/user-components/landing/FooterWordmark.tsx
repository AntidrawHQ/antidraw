/**
 * The page's sign-off: the wordmark banner (ReadmeBannerWordmark) as a full-width band under the footer.
 * The same pieces — the wordmark as a selected frame with its toolbar pill and handles, you and an agent on
 * it, over the glowing columns — with the wordmark at 0.625 of the banner's and the chrome at its own size,
 * as the hero's frames are.
 *
 * It looks clickable, so it is, a little: a click on the wordmark, its toolbar, either cursor or the columns
 * pops up an easter egg (landing/easter-eggs). BAND's values apply from sm up; a phone keeps its own.
 */
import type { CSSProperties } from "react"

import { AGENTS, BLUE, Pointer } from "../readme-art/pointer"
import { PillToggleToolbar } from "../landing-canvas/PillToggleToolbar"
import { COLUMN_GLOW_DEFAULTS, ColumnGlow, type ColumnGlowSettings } from "../parts/ColumnGlow"
import { GLOW_PALETTES } from "../landing-canvas/glowdial"
import iconUrl from "./antidraw-icon.svg?url"
import { useEasterEgg } from "./easter-eggs"

/** The banner's selection (644×168) at 0.625. */
const SEL = { w: 403, h: 105 }

/** The Glacier palette. */
const PALETTE = GLOW_PALETTES.find((p) => p.name === "Glacier")!.colors
const GLOW: ColumnGlowSettings = { ...COLUMN_GLOW_DEFAULTS, colors: [...PALETTE], columns: 48, arc: 38, motion: 0, background: "transparent" }
/** The band at sm and up: its height, the glow's, the wordmark's scale and its top. */
const BAND = { height: 360, glowHeight: 260, scale: 1, top: 88 }

/** What every part says when clicked. */
const EGG = "Bro, download the app instead of clicking around in the footer."

export function FooterWordmark() {
  const [glow, band] = [GLOW, BAND]
  const egg = useEasterEgg(EGG)
  const vars = { "--band-h": `${band.height}px`, "--glow-h": `${band.glowHeight}px`, "--mark-top": `${band.top}px`, "--mark-k": band.scale } as CSSProperties

  return (
    <>
      <div onClick={egg.onClick} className="relative h-[280px] overflow-hidden text-white sm:h-(--band-h)" style={vars}>
        {/* ColumnGlow's root is always `relative`, which outranks an `absolute` passed in, so a wrapper holds it to the bottom. */}
        <div aria-hidden data-egg="glow" className="absolute inset-x-0 bottom-0 h-[200px] sm:h-(--glow-h)">
          <ColumnGlow {...glow} className="h-full" />
        </div>

        {/* Shrunk on a phone so it fits the width. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[64px] flex justify-center sm:top-(--mark-top)">
          <div data-egg="wordmark" className="pointer-events-auto relative origin-top scale-[0.72] sm:scale-(--mark-k)" style={{ width: SEL.w, height: SEL.h }}>
            <div className="absolute bottom-full left-0 pb-1">
              <PillToggleToolbar componentName="Wordmark" nodeId="Wordmark" selected onSeeCode={() => {}} />
            </div>
            <div className="flex h-full items-center justify-center gap-[15px]">
              <img src={iconUrl} alt="" className="size-[65px]" />
              <span className="text-[80px] leading-none font-medium tracking-[-0.045em]">antidraw</span>
            </div>
            <div className="pointer-events-none absolute inset-0" style={{ boxShadow: `0 0 0 1.5px ${BLUE}` }}>
              {[
                [0, 0],
                [1, 0],
                [0, 1],
                [1, 1],
              ].map(([cx, cy]) => (
                <span
                  key={`${cx}${cy}`}
                  className="absolute size-[8px] -translate-x-1/2 -translate-y-1/2 rounded-[1px] border-[1.5px] bg-white"
                  style={{ left: `${cx * 100}%`, top: `${cy * 100}%`, borderColor: BLUE }}
                />
              ))}
            </div>
            <Pointer x={SEL.w - 25} y={SEL.h - 16} label="You" egg="you" />
            <Pointer x={-40} y={19} color={AGENTS.violet} label="Antidraw" agent egg="agent" />
          </div>
        </div>
        {egg.bubble}
      </div>

    </>
  )
}
