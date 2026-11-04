/**
 * Canvas pieces for the designer stories, ported from the real app:
 *
 *  - CanvasTools  components/CanvasToolbar.tsx (rail: Pointer / Inspect / Comment, ToolButton)
 *  - PickOutline  agent/overlay.ts — the picked element's 2-screen-px #3b82f6 outline
 *  - HoverBoxes   agent/overlay.ts — DevTools-style padding / content boxes while inspecting
 *  - Crosshair    agent/overlay.ts — the catcher's `cursor: crosshair` over a frame
 *  - KeyHint      a keycap that pops beside the cursor (story aid, not app UI)
 */
import { MessageCircle, MousePointer2, SquareDashedMousePointer } from "lucide-react"
import { motion, useTransform, type MotionValue } from "motion/react"

import { cn } from "@/lib/utils"
import { useCam } from "../../motion/canvas-ai/kit"

export type Tool = "pointer" | "inspect" | "comment"

const TOOLS: { id: Tool; Icon: typeof MousePointer2 }[] = [
  { id: "pointer", Icon: MousePointer2 },
  { id: "inspect", Icon: SquareDashedMousePointer },
  { id: "comment", Icon: MessageCircle },
]

/** The canvas toolbar rail (React Flow Panel top-left, 15px in). */
export function CanvasTools({ mode, className }: { mode: Tool; className?: string }) {
  return (
    <div className={cn("absolute top-[15px] left-[15px] z-30 flex flex-col gap-0.5 rounded-[12px] bg-[#262626] p-1", className)} style={{ boxShadow: "0 4px 16px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06)" }}>
      {TOOLS.map(({ id, Icon }) => {
        const active = id === mode
        return (
          <span key={id} className={cn("relative grid size-8 place-items-center rounded-[8px]", active ? "text-white/95" : "text-white/50")}>
            {active && <span className="absolute inset-0 rounded-[8px] bg-white/[0.1] ring-1 ring-white/[0.06]" />}
            <Icon size={16} strokeWidth={1.75} className="relative" />
          </span>
        )
      })}
    </div>
  )
}

export type Rect = { x: number; y: number; w: number; h: number }

/** The picked element's outline, in world space, two screen pixels wide at any zoom. */
export function PickOutline({ rect, color = "#3b82f6", opacity = 1, width = 2 }: { rect: MotionValue<Rect>; color?: string; opacity?: MotionValue<number> | number; width?: number }) {
  const { s } = useCam()
  const outline = useTransform(s, (v) => `${width / v}px solid ${color}`)
  const left = useTransform(rect, (r) => r.x)
  const top = useTransform(rect, (r) => r.y)
  const w = useTransform(rect, (r) => r.w)
  const h = useTransform(rect, (r) => r.h)
  return <motion.div className="pointer-events-none absolute z-20" style={{ left, top, width: w, height: h, outline, opacity }} />
}

/** DevTools-style boxes over the hovered element: padding (green border) and content (blue fill). */
export function HoverBoxes({ rect, pad = 0, opacity = 1 }: { rect: Rect; pad?: number; opacity?: MotionValue<number> | number }) {
  return (
    <motion.div className="pointer-events-none absolute z-10" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, opacity }}>
      <div className="absolute inset-0" style={{ border: `${pad}px solid rgba(147, 196, 125, 0.5)` }} />
      <div className="absolute" style={{ inset: pad, background: "rgba(111, 168, 220, 0.5)" }} />
    </motion.div>
  )
}

/** The inspector's crosshair cursor, in stage space. */
export function Crosshair({ x, y, opacity, press }: { x: MotionValue<number>; y: MotionValue<number>; opacity?: MotionValue<number> | number; press?: MotionValue<number> }) {
  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-50" style={{ x, y, opacity }}>
      <motion.svg width="23" height="23" viewBox="0 0 23 23" className="-translate-x-1/2 -translate-y-1/2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" style={{ scale: press }}>
        <path d="M11.5 1v21M1 11.5h21" stroke="black" strokeWidth="3" />
        <path d="M11.5 1.5v20M1.5 11.5h20" stroke="white" strokeWidth="1.2" />
      </motion.svg>
    </motion.div>
  )
}

/** A keycap that pops beside the cursor ("Enter"). */
export function KeyHint({ x, y, label, opacity, scale }: { x: MotionValue<number>; y: MotionValue<number>; label: string; opacity: MotionValue<number>; scale?: MotionValue<number> }) {
  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-50" style={{ x, y, opacity }}>
      <motion.span
        className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-white/15 bg-[#1e1e1e] px-2 font-mono text-[11px] text-white/80 shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
        style={{ scale }}
      >
        {label}
      </motion.span>
    </motion.div>
  )
}
