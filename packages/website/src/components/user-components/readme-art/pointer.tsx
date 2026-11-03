/**
 * The canvas's cursors and colours, for the README banners (readme-art/banner) and the landing's
 * FooterWordmark. A module of its own because banner.tsx turns motion's animations off when it loads
 * (its banners are stills): the live page imports from here, so its animations keep running.
 */
import { AgentIcon } from "../motion/canvas-ai/kit"

export const BLUE = "#3b82f6"
export const AGENTS = { blue: "#3a5fb0", violet: "#7c5cff", green: "#16a34a", pink: "#db2777" }

const ARROW = "M3 2.5 L3 17.5 L7.2 13.6 L10.1 19.6 L12.6 18.4 L9.8 12.6 L15.5 12.4 Z"

/** A cursor with its name tag: an Antidraw agent's (`agent`, with the icon) or yours ("You", black). */
export function Pointer({ x, y, color = "#111", label, agent }: { x: number; y: number; color?: string; label: string; agent?: boolean }) {
  return (
    <div className="pointer-events-none absolute z-50" style={{ left: x, top: y }}>
      <svg width="22" height="22" viewBox="0 0 22 22" className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]">
        <path d={ARROW} fill={color} stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <div
        className="absolute top-[18px] left-[14px] flex items-center gap-1 rounded-[5px] px-1.5 py-[3px] text-[11px] font-semibold whitespace-nowrap text-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
        style={{ background: color }}
      >
        {agent && <AgentIcon size={12} />}
        {label}
      </div>
    </div>
  )
}
