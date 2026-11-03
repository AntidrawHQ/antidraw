/**
 * The DialKit panel that tunes the canvas landing's ColumnGlow frame: DialKit's real Folder, Select
 * and Sliders, mounted statically (as usecase/design/springs.tsx does) so a timeline drives every
 * value. `hot` names the control the agent's pointer is on, which DialKit shows as its hover state.
 */
import "dialkit/styles.css"

import { useEffect, useRef } from "react"
import { Folder, SelectControl, Slider } from "dialkit"

/** The palettes the agent flicks through (ColumnGlow's own presets). */
export const GLOW_PALETTES: { name: string; colors: string[] }[] = [
  { name: "Dusk", colors: ["#1b3474", "#4b4fa8", "#7c6cd6", "#c47aa8", "#d97757", "#f4d6c4"] },
  { name: "Milana", colors: ["#2a0a1f", "#7a1a4f", "#e0338a", "#ff5fb0", "#f5a3d0", "#e8ff7a"] },
  { name: "Glacier", colors: ["#0b1d33", "#2f6dbf", "#5b8cff", "#7ff3ff", "#e8fbff"] },
  { name: "Mars", colors: ["#2a0d08", "#ff4d2e", "#ff9e3d", "#ffd27a", "#fff3d6"] },
]

export const DIAL_W = 280

const noop = () => {}

/** DialKit's Slider with its hover replayed: a scripted pointer never hovers for real. */
function ScriptedSlider({ label, value, min, max, step, active = false }: { label: string; value: number; min: number; max: number; step: number; active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current?.querySelector(".dialkit-slider")
    el?.dispatchEvent(new MouseEvent(active ? "mouseover" : "mouseout", { bubbles: true, relatedTarget: null }))
  }, [active])
  return (
    <div ref={ref}>
      <Slider label={label} value={value} min={min} max={max} step={step} onChange={noop} />
    </div>
  )
}

export function GlowDial({ palette, columns, arc, glow, hot }: { palette: string; columns: number; arc: number; glow: number; hot?: "arc" | "glow" | null }) {
  return (
    <div className="dialkit-root" data-theme="dark" style={{ width: DIAL_W }}>
      <div className="dialkit-panel" style={{ position: "relative", zIndex: "auto", maxHeight: "none", width: "100%" }}>
        <Folder title="ColumnGlow" isRoot>
          <SelectControl label="Palette" value={palette} options={GLOW_PALETTES.map((p) => ({ value: p.name, label: p.name }))} onChange={noop} />
          <ScriptedSlider label="Columns" value={columns} min={4} max={80} step={1} />
          <ScriptedSlider label="Arc" value={arc} min={0} max={70} step={1} active={hot === "arc"} />
          <ScriptedSlider label="Glow blur" value={glow} min={0} max={60} step={1} active={hot === "glow"} />
        </Folder>
      </div>
    </div>
  )
}
