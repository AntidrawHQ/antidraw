/**
 * Ark UI: headless components on Zag state machines, from `@ark-ui/react`. An inline color picker
 * (saturation area, hue and alpha channels, hex input, eyedropper, swatches), styled with Tailwind.
 */
import { ColorPicker, parseColor } from "@ark-ui/react/color-picker"
import { Pipette } from "lucide-react"

import type { Mark } from "../../antidraw-empty/logos"
import type { LibraryTile } from "../tile"

/** Ark UI isn't in Simple Icons, so a neutral monogram chip. */
export const arkMark: Mark = {
  bg: "#3f3f46",
  node: <span className="font-sans text-[10.5px] leading-none font-bold tracking-[-0.02em] text-white">A</span>,
}

const SWATCHES = ["#f43f5e", "#f59e0b", "#10b981", "#0ea5e9", "#6366f1", "#d946ef"]

const thumb = "size-3.5 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_1px_4px_rgba(0,0,0,0.5)] outline-none"

function ArkDemo() {
  return (
    <ColorPicker.Root
      inline
      defaultValue={parseColor("hsla(160, 84%, 39%, 1)")}
      className="flex w-full max-w-[272px] flex-col gap-3 rounded-xl border border-white/[0.08] bg-[#18181b] p-3 font-sans text-white antialiased shadow-[0_20px_40px_-12px_rgba(0,0,0,0.6)]"
    >
      <ColorPicker.Area className="relative h-[112px] w-full overflow-hidden rounded-lg">
        <ColorPicker.AreaBackground className="size-full" />
        <ColorPicker.AreaThumb className={thumb} />
      </ColorPicker.Area>

      <div className="flex items-center gap-3">
        <ColorPicker.EyeDropperTrigger
          aria-label="Pick from screen"
          className="grid size-7 shrink-0 place-items-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Pipette className="size-4" />
        </ColorPicker.EyeDropperTrigger>
        <div className="flex flex-1 flex-col gap-2">
          <ColorPicker.ChannelSlider channel="hue" className="relative h-2.5 w-full">
            <ColorPicker.ChannelSliderTrack className="h-full rounded-full" />
            <ColorPicker.ChannelSliderThumb className={`${thumb} top-1/2 -translate-y-1/2`} />
          </ColorPicker.ChannelSlider>
          <ColorPicker.ChannelSlider channel="alpha" className="relative h-2.5 w-full">
            <ColorPicker.TransparencyGrid size="6px" className="rounded-full" />
            <ColorPicker.ChannelSliderTrack className="h-full rounded-full" />
            <ColorPicker.ChannelSliderThumb className={`${thumb} top-1/2 -translate-y-1/2`} />
          </ColorPicker.ChannelSlider>
        </div>
        <ColorPicker.ValueSwatch className="size-7 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]" />
      </div>

      <div className="flex items-center gap-2">
        {/* Ark leaves this uncontrolled and, inline, doesn't re-sync it when the colour changes;
            keying it on the value remounts it with the fresh hex. */}
        <ColorPicker.Context>
          {(api) => (
            <ColorPicker.ChannelInput
              key={api.value.toString("hex")}
              channel="hex"
              aria-label="Hex"
              className="h-7 w-[84px] rounded-md border border-white/10 bg-white/[0.04] px-2 font-mono text-[12px] uppercase text-white/90 outline-none focus:border-emerald-400/70"
            />
          )}
        </ColorPicker.Context>
        <ColorPicker.SwatchGroup className="ml-auto flex gap-1.5">
          {SWATCHES.map((c) => (
            <ColorPicker.SwatchTrigger key={c} value={c} className="group relative rounded-full outline-none">
              <ColorPicker.Swatch
                value={c}
                className="size-5 rounded-full ring-white/0 ring-offset-2 ring-offset-[#18181b] transition group-hover:scale-110 group-data-[state=checked]:ring-2 group-data-[state=checked]:ring-white/80"
              />
            </ColorPicker.SwatchTrigger>
          ))}
        </ColorPicker.SwatchGroup>
      </div>
      <ColorPicker.HiddenInput />
    </ColorPicker.Root>
  )
}

export const arkTile: LibraryTile = {
  id: "ark",
  library: "Ark UI",
  maker: "Chakra UI",
  pkg: "@ark-ui/react",
  mark: arkMark,
  ground: "#0e0e10",
  Component: ArkDemo,
}
