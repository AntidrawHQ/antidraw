/**
 * The brand kit and the campaign asset set for UseCaseMarketingOnBrand:
 * Halcyon (a made-up coffee roaster) — its mark, the three files a marketer
 * drops in (logo, palette, type), the BrandTokens frame Claude derives, and
 * four assets that all read those tokens (story, square, email header, web
 * banner), so a token change re-themes them together. Colours ease between
 * themes with CSS transitions.
 */
import type { CSSProperties, ReactNode } from "react"
import { motion } from "motion/react"
import { ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { useTrack } from "../../motion/canvas-ai/kit"

export type Theme = { name: string; paper: string; ink: string; accent: string; soft: string }
export const THEMES: Record<"day" | "night", Theme> = {
  day: { name: "Day", paper: "#fff4e0", ink: "#1b2bd6", accent: "#ff6a2a", soft: "#ffd9b8" },
  night: { name: "Night", paper: "#12143a", ink: "#fff4e0", accent: "#ff8a3d", soft: "#2a2f78" },
}

const EASE = "cubic-bezier(.65,0,.35,1)"
const tr: CSSProperties = { transition: `background-color .7s ${EASE}, color .7s ${EASE}, border-color .7s ${EASE}, fill .7s ${EASE}, stroke .7s ${EASE}` }
const loop = (t: number, len: number) => ((t % len) + len) % len

/** Halcyon's mark: a sun over two waves, in a roundel. */
export function HalcyonMark({ size = 24, color, bg }: { size?: number; color: string; bg?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {bg && <circle cx="12" cy="12" r="12" style={{ ...tr, fill: bg }} />}
      <circle cx="12" cy="10" r="4.2" style={{ ...tr, fill: color }} />
      <path d="M4.5 15.5 q 2.5 -2 5 0 t 5 0 t 5 0" strokeWidth="1.8" strokeLinecap="round" style={{ ...tr, stroke: color }} />
      <path d="M6 19 q 2 -1.6 4 0 t 4 0 t 4 0" strokeWidth="1.8" strokeLinecap="round" style={{ ...tr, stroke: color }} />
    </svg>
  )
}

/* ── The three dropped files (as composer thumbnails / dragged cards) ── */

export function LogoThumb({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center bg-[#fff4e0]", className)}>
      <HalcyonMark size={34} color="#1b2bd6" />
    </div>
  )
}
export function PaletteThumb({ className }: { className?: string }) {
  const t = THEMES.day
  return (
    <div className={cn("flex", className)}>
      {[t.ink, t.accent, t.soft, t.paper].map((c) => (
        <span key={c} className="h-full flex-1" style={{ background: c }} />
      ))}
    </div>
  )
}
export function TypeThumb({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center bg-white leading-none text-[#1b2bd6]", className)}>
      <span className="font-serif text-[26px] italic">Aa</span>
      <span className="mt-0.5 text-[7px] font-semibold tracking-[0.12em] uppercase">Display</span>
    </div>
  )
}
export const FILES = [
  { name: "halcyon-logo.png", Thumb: LogoThumb },
  { name: "palette.png", Thumb: PaletteThumb },
  { name: "type-specimen.png", Thumb: TypeThumb },
] as const

/* ── BrandTokens frame: natural 844×84 ───────────────────────────────── */

export function BrandTokens({ theme }: { theme: Theme }) {
  const sw: [string, string][] = [
    ["Ink", theme.ink],
    ["Accent", theme.accent],
    ["Soft", theme.soft],
    ["Paper", theme.paper],
  ]
  return (
    <div className="flex size-full items-center gap-8 bg-[#1e1e1e] px-6 font-sans text-white">
      <div className="flex items-center gap-3">
        <HalcyonMark size={40} color={theme.paper} bg={theme.ink} />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold">Halcyon</div>
          <div className="text-[11px] text-white/45">brand.ts · {theme.name}</div>
        </div>
      </div>
      <div className="h-10 w-px bg-white/10" />
      <div className="flex gap-4">
        {sw.map(([n, c]) => (
          <div key={n} className="flex items-center gap-2">
            <span className="size-8 rounded-full ring-1 ring-white/15" style={{ ...tr, background: c }} />
            <div className="leading-tight">
              <div className="text-[11px] text-white/80">{n}</div>
              <div className="font-mono text-[10px] text-white/40 uppercase">{c}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="h-10 w-px bg-white/10" />
      <div className="flex items-baseline gap-4">
        <span className="font-serif text-[30px] italic">Aa</span>
        <span className="text-[11px] leading-tight text-white/45">
          Display serif
          <br />
          Text sans
        </span>
      </div>
    </div>
  )
}

/* ── The cold-brew can ───────────────────────────────────────────────── */

function Can({ theme, w, className, style }: { theme: Theme; w: number; className?: string; style?: CSSProperties }) {
  const h = w * 1.7
  return (
    <div className={cn("relative", className)} style={{ width: w, height: h, ...style }}>
      <div className="absolute inset-x-[6%] top-0 h-[7%] rounded-t-[40%] bg-[#c9c9cf]" />
      <div className="absolute inset-x-0 top-[5%] bottom-0 flex flex-col items-center justify-center overflow-hidden rounded-[18%/10%]" style={{ ...tr, background: theme.ink }}>
        <div className="absolute inset-y-0 left-[12%] w-[10%] bg-white/15" />
        <HalcyonMark size={w * 0.42} color={theme.paper} />
        <div className="mt-[6%] font-serif italic" style={{ ...tr, color: theme.paper, fontSize: w * 0.17 }}>
          Halcyon
        </div>
        <div className="mt-[8%] rounded-full px-[10%] py-[3%] font-semibold tracking-[0.1em] uppercase" style={{ ...tr, background: theme.accent, color: theme.ink, fontSize: w * 0.075 }}>
          Cold brew
        </div>
      </div>
    </div>
  )
}

function Cta({ theme, children, size }: { theme: Theme; children: ReactNode; size: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full font-semibold" style={{ ...tr, background: theme.accent, color: theme.paper === "#fff4e0" ? "#fff" : theme.paper, fontSize: size, padding: `${size * 0.55}px ${size * 1.2}px` }}>
      {children} <ArrowRight style={{ width: size, height: size }} strokeWidth={2.6} />
    </span>
  )
}

/* ── Story: natural 360×640 ──────────────────────────────────────────── */

export function StoryPost({ theme }: { theme: Theme }) {
  const fill = useTrack((t) => `${(loop(t, 5) / 5) * 100}%`)
  const bob = useTrack((t) => Math.sin(loop(t, 3) * ((Math.PI * 2) / 3)) * 6)
  return (
    <div className="relative size-full overflow-hidden font-sans" style={{ ...tr, background: theme.paper }}>
      <div className="absolute inset-x-4 top-4 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ ...tr, background: `${theme.ink}33` }}>
            {i === 0 && <motion.span className="block h-full" style={{ ...tr, width: fill, background: theme.ink }} />}
          </span>
        ))}
      </div>
      <div className="absolute top-10 left-5 flex items-center gap-2">
        <HalcyonMark size={30} color={theme.paper} bg={theme.ink} />
        <span className="text-[15px] font-semibold" style={{ ...tr, color: theme.ink }}>
          halcyon
        </span>
      </div>
      <div className="absolute top-[100px] left-5 font-serif text-[56px] leading-[0.95] italic" style={{ ...tr, color: theme.ink }}>
        Cold brew
        <br />
        season.
      </div>
      <div className="absolute top-[250px] left-1/2 size-[230px] -translate-x-1/2 rounded-full" style={{ ...tr, background: theme.soft }} />
      <motion.div className="absolute top-[250px] left-1/2 -ml-[65px]" style={{ y: bob }}>
        <Can theme={theme} w={130} />
      </motion.div>
      <div className="absolute inset-x-0 bottom-9 flex justify-center">
        <Cta theme={theme} size={18}>
          Order ahead
        </Cta>
      </div>
    </div>
  )
}

/* ── Square: natural 540×540 ─────────────────────────────────────────── */

export function SocialSquare({ theme }: { theme: Theme }) {
  const spin = useTrack((t) => (loop(t, 12) / 12) * 360)
  return (
    <div className="relative size-full overflow-hidden font-sans" style={{ ...tr, background: theme.accent }}>
      <div className="absolute top-1/2 left-1/2 size-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ ...tr, background: theme.soft }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[46%]">
        <Can theme={theme} w={150} />
      </div>
      <div className="absolute top-8 left-9 font-serif text-[52px] leading-none italic" style={{ ...tr, color: theme.ink }}>
        Summer drop
      </div>
      <motion.svg viewBox="0 0 100 100" className="absolute right-8 bottom-8 size-[130px]" style={{ rotate: spin }}>
        <circle cx="50" cy="50" r="48" style={{ ...tr, fill: theme.ink }} />
        <defs>
          <path id="uc-badge" d="M50 50 m -34 0 a 34 34 0 1 1 68 0 a 34 34 0 1 1 -68 0" />
        </defs>
        <text fontSize="13" fontWeight="700" letterSpacing="3" style={{ ...tr, fill: theme.paper }}>
          <textPath href="#uc-badge">NEW · LIMITED · NEW · LIMITED ·</textPath>
        </text>
      </motion.svg>
    </div>
  )
}

/* ── Email header: natural 600×250 ───────────────────────────────────── */

export function EmailHeader({ theme }: { theme: Theme }) {
  return (
    <div className="relative size-full overflow-hidden font-sans" style={{ ...tr, background: theme.ink }}>
      <svg viewBox="0 0 600 250" className="absolute inset-0 size-full" preserveAspectRatio="none">
        {[0, 1, 2, 3].map((i) => (
          <path key={i} d={`M0 ${170 + i * 22} q 75 -26 150 0 t 150 0 t 150 0 t 150 0`} fill="none" strokeWidth="3" style={{ ...tr, stroke: theme.accent, opacity: 0.25 + i * 0.15 }} />
        ))}
      </svg>
      <div className="absolute top-7 left-8 flex items-center gap-2.5">
        <HalcyonMark size={34} color={theme.ink} bg={theme.paper} />
        <span className="text-[18px] font-semibold" style={{ ...tr, color: theme.paper }}>
          halcyon
        </span>
      </div>
      <div className="absolute top-[78px] left-8 font-serif text-[50px] leading-none italic" style={{ ...tr, color: theme.paper }}>
        Cold brew is back.
      </div>
      <div className="absolute top-[140px] left-8 text-[16px]" style={{ ...tr, color: theme.soft }}>
        Twelve hours steeped. Ready when you are.
      </div>
    </div>
  )
}

/* ── Web banner: natural 728×246 ─────────────────────────────────────── */

export function WebBanner({ theme }: { theme: Theme }) {
  return (
    <div className="relative flex size-full items-center gap-7 overflow-hidden px-9 font-sans" style={{ ...tr, background: theme.soft }}>
      <div className="absolute -left-10 size-[260px] rounded-full" style={{ ...tr, background: theme.accent }} />
      <Can theme={theme} w={110} className="relative -rotate-6" />
      <div className="relative flex-1 font-serif text-[46px] leading-[0.98] italic" style={{ ...tr, color: theme.ink }}>
        Cold brew
        <br />
        season.
      </div>
      <div className="relative">
        <Cta theme={theme} size={20}>
          Order
        </Cta>
      </div>
    </div>
  )
}
