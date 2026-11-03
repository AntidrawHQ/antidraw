/**
 * The DialKit panel that tunes the canvas landing's ColumnGlow frame: DialKit's Folder, Select and
 * Sliders, drawn statically (dialkit-replica.tsx, as usecase/design/springs.tsx does) so a timeline drives
 * every value. `hot` names the control the agent's pointer is on, which DialKit shows as its hover state.
 */
import { DialPanel, DialSelect, DialSlider } from "./dialkit-replica"

/** The palettes the agent flicks through (ColumnGlow's own presets). */
export const GLOW_PALETTES: { name: string; colors: string[] }[] = [
  { name: "Dusk", colors: ["#1b3474", "#4b4fa8", "#7c6cd6", "#c47aa8", "#d97757", "#f4d6c4"] },
  { name: "Milana", colors: ["#2a0a1f", "#7a1a4f", "#e0338a", "#ff5fb0", "#f5a3d0", "#e8ff7a"] },
  { name: "Glacier", colors: ["#0b1d33", "#2f6dbf", "#5b8cff", "#7ff3ff", "#e8fbff"] },
  { name: "Mars", colors: ["#2a0d08", "#ff4d2e", "#ff9e3d", "#ffd27a", "#fff3d6"] },
]

export const DIAL_W = 280

export function GlowDial({ palette, columns, arc, glow, hot }: { palette: string; columns: number; arc: number; glow: number; hot?: "arc" | "glow" | null }) {
  return (
    <DialPanel title="ColumnGlow" width={DIAL_W}>
      <DialSelect label="Palette" value={palette} />
      <DialSlider label="Columns" value={columns} min={4} max={80} step={1} />
      <DialSlider label="Arc" value={arc} min={0} max={70} step={1} active={hot === "arc"} />
      <DialSlider label="Glow blur" value={glow} min={0} max={60} step={1} active={hot === "glow"} />
    </DialPanel>
  )
}
