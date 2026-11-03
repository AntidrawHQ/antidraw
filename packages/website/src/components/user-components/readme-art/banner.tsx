/**
 * Shared pieces for the README banners (ReadmeBanner*.tsx): a 1280×640 artboard scaled to fit its
 * frame, and stills of the landing canvas's parts — a frame with the app's toolbar pill above it,
 * your cursor and an Antidraw agent's, the navbar's lockup and the hero's headline.
 *
 * The frames themselves (BloomSite, SproutHome, ColumnGlow…) are copied as-is from the website's
 * landing (packages/website/src/components/user-components) into this folder.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { MotionGlobalConfig } from "motion/react"

import { cn } from "@/lib/utils"
import { LandingFontFaces, fontStack } from "../landing/LandingFonts"
import { PillToggleToolbar } from "../landing-canvas/PillToggleToolbar"
import { AgentIcon } from "../motion/canvas-ai/kit"
import iconUrl from "../landing/antidraw-icon.svg?url"
import { AGENTS, BLUE, Pointer } from "./pointer"

export { AGENTS, BLUE, Pointer }

// The banners are stills: the toolbar pills (and anything else on motion) render at their end state, not mid-animation.
MotionGlobalConfig.skipAnimations = true

/** GitHub's social preview size; also fills the README's column at 2×. */
export const W = 1280
export const H = 640

export const PAGE = { dark: "#232323", light: "#f5f5f4" }
export const LIME = "#C6F432"

/** The artboard, at its own 1280×640, scaled down to fit the frame it's previewed in and centred there. */
export function Banner({ bg = PAGE.dark, className, children }: { bg?: string; className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [k, setK] = useState(1)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setK(Math.min(e.contentRect.width / W, e.contentRect.height / H)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={box} className="relative grid h-screen w-screen place-items-center overflow-hidden bg-[#111]">
      <LandingFontFaces />
      <div style={{ width: W * k, height: H * k }}>
        <div
          className={cn("relative origin-top-left overflow-hidden antialiased", className)}
          style={{ width: W, height: H, transform: `scale(${k})`, background: bg, fontFamily: fontStack("schibsted") }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

/** A frame on the canvas: the toolbar pill above it, the component at its natural `nw`×`nh` shown at `s`, the blue outline and handles when selected. */
export function Frame({ name, x, y, nw, nh, s, selected, light, children, style }: { name: string; x: number; y: number; nw: number; nh: number; s: number; selected?: boolean; light?: boolean; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="absolute" style={{ left: x, top: y, width: nw * s, height: nh * s, ...style }}>
      <div className="absolute bottom-full left-0 pb-1">
        {selected ? (
          <PillToggleToolbar componentName={name} nodeId={name} selected onSeeCode={() => {}} />
        ) : (
          // The unselected pill at rest: just the name, white at 30% (grey on the light page). Drawn directly, as the pill's shadow layer starts visible and fades out.
          <span className={cn("flex h-9 items-center py-[5px] pr-3 text-xs font-medium whitespace-nowrap", light ? "text-black/40" : "text-white/30")}>{name}</span>
        )}
      </div>
      <div className={cn("absolute inset-0 overflow-hidden rounded-[4px]", light ? "shadow-[0_12px_32px_-14px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.06]" : "shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]")}>
        <div className="absolute top-0 left-0 origin-top-left" style={{ width: nw, height: nh, transform: `scale(${s})` }}>
          {children}
        </div>
      </div>
      {selected && (
        <div className="pointer-events-none absolute inset-0 rounded-[4px]" style={{ boxShadow: `0 0 0 1.5px ${BLUE}` }}>
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
      )}
    </div>
  )
}



/** The navbar's lockup: icon, "Antidraw", the Alpha badge. `k` scales it. */
export function Lockup({ k = 1, light, badge = true, className, style }: { k?: number; light?: boolean; badge?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("flex items-center", light ? "text-[#171717]" : "text-white", className)} style={{ gap: 10 * k, ...style }}>
      <img src={iconUrl} alt="" style={{ width: 34 * k, height: 34 * k }} />
      <span className="font-medium tracking-[-0.02em]" style={{ fontSize: 22 * k }}>
        Antidraw
      </span>
      {badge && (
        <span
          className={cn("rounded-[5px] leading-none font-medium tracking-[0.02em]", light ? "bg-black/[0.06] text-black/50" : "bg-white/10 text-white/50")}
          style={{ fontSize: 11 * k, padding: `${3 * k}px ${6 * k}px` }}
        >
          Alpha
        </span>
      )}
    </div>
  )
}

/** The hero's headline, in the landing's three lines. */
export function Headline({ size = 32, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <h1 className={cn("leading-[1.1] font-medium tracking-[-0.025em]", className)} style={{ fontSize: size, fontVariationSettings: '"opsz" 32', ...style }}>
      product design &amp; prototyping
      <br />
      canvas for your coding agents
      <br />
      powered by real code.
    </h1>
  )
}
