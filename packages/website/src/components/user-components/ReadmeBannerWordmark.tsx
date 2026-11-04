/**
 * README banner, 1280×640: the wordmark itself as a frame on the canvas — selected, with its
 * toolbar pill and handles, you and an agent on it — over the essay landing's glowing columns.
 */
import { AGENTS, BLUE, Banner, Pointer } from "./readme-art/banner"
import { PillToggleToolbar } from "./landing-canvas/PillToggleToolbar"
import { COLUMN_GLOW_DEFAULTS, ColumnGlow } from "./parts/ColumnGlow"
import { GLOW_PALETTES } from "./landing-canvas/glowdial"
import iconUrl from "./landing/antidraw-icon.svg?url"

/** The selection around the wordmark, in artboard px. */
const SEL = { x: 318, y: 112, w: 644, h: 168 }

export default function ReadmeBannerWordmark() {
  return (
    <Banner className="text-white">
      {/* ColumnGlow's root is `relative`, so it's placed by a wrapper. */}
      <div className="absolute inset-x-0 bottom-0 h-[420px]">
        <ColumnGlow {...COLUMN_GLOW_DEFAULTS} colors={GLOW_PALETTES[0].colors} columns={48} arc={38} motion={0} background="transparent" className="h-full w-full" />
      </div>

      <div className="absolute" style={{ left: SEL.x, top: SEL.y, width: SEL.w, height: SEL.h }}>
        <div className="absolute bottom-full left-0 pb-1">
          <PillToggleToolbar componentName="Wordmark" nodeId="Wordmark" selected onSeeCode={() => {}} />
        </div>
        <div className="flex h-full items-center justify-center gap-6">
          <img src={iconUrl} alt="" className="size-[104px]" />
          <span className="text-[128px] leading-none font-medium tracking-[-0.045em]">antidraw</span>
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
      </div>

      <p className="absolute inset-x-0 top-[310px] text-center text-[24px] font-medium tracking-[-0.02em] text-white/60">stop drawing. start describing.</p>

      <Pointer x={SEL.x + SEL.w - 40} y={SEL.y + SEL.h - 26} label="You" />
      <Pointer x={SEL.x - 64} y={SEL.y + 30} color={AGENTS.violet} label="Antidraw" agent />
    </Banner>
  )
}
