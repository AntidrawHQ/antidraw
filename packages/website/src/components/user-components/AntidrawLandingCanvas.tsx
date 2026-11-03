/**
 * The landing as the canvas itself: the whole screen is Antidraw's canvas, plain and drifting, with
 * frames scattered around it: two phone screens in the middle, pastel websites, the essay landing's glowing columns (tuned live in DialKit), a poster and two Mobbin-inspired
 * pieces (landing-canvas/inspired.tsx) on either side
 * (landing-canvas/pastels.tsx), the title above them. One person works it (you) and several Antidraw agents, each its own colour:
 *
 *  - You, on a 16s loop: inspect SproutHome's Round-ups card, scrub its padding 16 → 24 and drag its
 *    fill to lime in the Design panel (the panel marks them edited), then
 *    pin two comments: "Make the hero lilac" on BloomSite, a green "Book 2 nights" on FernhollowStay.
 *    A violet agent and a green agent take one each, make the change, and resolve the pin.
 *  - A blue agent builds OrbitSite from a shimmer (8s); a pink one tunes ColumnGlow in its DialKit panel,
 *    flicking through palettes and dragging Arc and Glow blur (10s).
 *
 * Mirrored about the centre: the phones (the Design panel in the gap between them), then on each side a
 * website over a pair: ColumnGlow and its panel on the left; the Tidepod player and a boarding card over a poster on the right.
 *
 * Everything runs off motion's clock (useTime), so cursors move at full frame rate; only the values a
 * component needs as props re-render it. Laid out for 1440×900 around the screen's centre, scaled to the window.
 */
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react"
import { motion, useMotionValueEvent, useTime, useTransform, type MotionValue } from "motion/react"
import { Check, ChevronDown, Scan } from "lucide-react"

import { cn } from "@/lib/utils"
import { PATHS } from "./antidraw-empty/logos"
import { AgentIcon, Cursor, E, Skeleton, kf, mix, ramp, type Key } from "./motion/canvas-ai/kit"
import { PillToggleToolbar } from "./landing-canvas/PillToggleToolbar"
import { Add, AlignPad, ColorRow, Corner, EyeBtn, FLOW_OPTS, IconBtn, Num, RemoveBtn, RightPanelShell, Section, Sections, Seg, SizeField, T as K } from "./usecase/design/panel"
import { BLOOM_HEAD, BloomSite, OrbitSite, PastelPoster, POSTER_H, POSTER_W, SITE_H, SITE_W } from "./landing-canvas/pastels"
import { COLUMN_GLOW_DEFAULTS, ColumnGlow } from "./parts/ColumnGlow"
import { DIAL_W, GLOW_PALETTES, GlowDial } from "./landing-canvas/glowdial"
import { BOARD_H, BOARD_W, BoardingCard, PLAYER_H, PLAYER_W, TidepodPlayer } from "./landing-canvas/inspired"
import { SproutHome, cardH, cardRect } from "./usecase/design/sprout"
import { FernhollowStay } from "./usecase/design/fernhollow"
import { LandingFontFaces, fontStack } from "./landing/LandingFonts"
import { EssayNav, NAV_H } from "./landing/EssayNav"
import { DOWNLOADS, DownloadButton } from "./landing/DownloadButton"
import { EssaySections } from "./landing/EssaySections"
import { LandingFooter, type FooterStyle } from "./landing/Footers"
import { TypeScaleCtx } from "./landing/TypeScale"

const REPO = "https://github.com/AntidrawHQ/antidraw"
const BLUE = "#3b82f6"
/** The agents' cursor colours: one per agent at work. */
const AGENTS = { blue: "#3a5fb0", violet: "#7c5cff", green: "#16a34a", pink: "#db2777" }

const AppleMark = ({ className = "size-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M16.37 12.68c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.65ZM14.1 5.92c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.01.08 2.05-.52 2.69-1.28Z" />
  </svg>
)
const GithubMark = ({ className = "size-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d={PATHS.github.d} />
  </svg>
)

/* ── Clock ──────────────────────────────────────────────────────────── */

/** Seconds into a `period`-second loop, as a motion value. */
function useLoop(period: number) {
  const time = useTime()
  return useTransform(time, (ms) => (ms / 1000) % period)
}
/** A motion value derived from the loop's time. */
const useOn = <T,>(t: MotionValue<number>, fn: (t: number) => T) => useTransform(t, fn)
/** A primitive derived from the loop's time, as state: re-renders only when it changes. */
function useStep<T extends string | number | boolean>(t: MotionValue<number>, fn: (t: number) => T): T {
  const [v, setV] = useState<T>(() => fn(t.get()))
  useMotionValueEvent(t, "change", (x) => {
    const n = fn(x)
    setV((p) => (Object.is(p, n) ? p : n))
  })
  return v
}
type PathKeys = [number, number, number][]
/** A cursor's path: [time, x, y] keys, eased between. */
const along = (t: number, keys: PathKeys) => [kf(t, keys.map(([s, x]) => [s, x, E.inOut] as Key)), kf(t, keys.map(([s, , y]) => [s, y, E.inOut] as Key))] as const
/** A cursor following `keys` on loop `t`, as x/y motion values. */
function usePath(t: MotionValue<number>, keys: PathKeys) {
  return { x: useOn(t, (s) => along(s, keys)[0]), y: useOn(t, (s) => along(s, keys)[1]) }
}
const typedAt = (t: number, a: number, b: number, text: string) => text.slice(0, Math.round(ramp(t, a, b, (x) => x) * text.length))
const lerpHex = (a: string, b: string, p: number) => {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [c(a), c(b)]
  return `#${x.map((v, i) => Math.round(mix(v, y[i], p)).toString(16).padStart(2, "0")).join("")}`.toUpperCase()
}

/* ── Stage ──────────────────────────────────────────────────────────── */

/** The canvas is drawn for 1440×900; this scales it to the window, within reason. Also gives the window's width. */
function useStageScale() {
  const read = () => [Math.min(1.25, Math.max(0.55, Math.min(window.innerWidth / 1440, window.innerHeight / 900))), window.innerWidth] as const
  const [k, setK] = useState(read)
  useEffect(() => {
    const on = () => setK(read())
    window.addEventListener("resize", on)
    return () => window.removeEventListener("resize", on)
  }, [])
  return k
}

/** The page in each theme. The app's own chrome (selected pill, Design panel, notes) stays dark, as in the app. */
const TONES = {
  dark: {
    page: "bg-[#232323] text-white",
    label: "rgba(255,255,255,0.3)",
    shadow: "shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]",
    solid: "bg-white text-[#171717]",
    alpha: "bg-black/[0.07] text-black/55",
    ghost: "border-white/15 bg-[#2a2a2a] text-white hover:bg-[#333]",
  },
  light: {
    page: "bg-[#f5f5f4] text-[#171717]",
    label: "rgba(0,0,0,0.4)",
    shadow: "shadow-[0_12px_32px_-14px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.06]",
    solid: "bg-[#171717] text-white",
    alpha: "bg-white/[0.14] text-white/70",
    ghost: "border-black/15 bg-white text-[#171717] hover:bg-black/[0.03]",
  },
}
type Theme = keyof typeof TONES
const ThemeCtx = createContext<Theme>("dark")

/** Phone frames are 300×600 components, shown at this scale. */
const S = 0.62
const FW = 300 * S
const FH = 600 * S

/** A frame on the canvas: the app's toolbar pill above it, the component scaled inside, the blue outline and handles when selected. */
/** `nw`×`nh` is the component's natural size, shown at `s`; the defaults are a phone screen. */
function CanvasFrame({ name, x, y, nw = 300, nh = 600, s = S, selected, children, style }: { name: string; x: number; y: number; nw?: number; nh?: number; s?: number; selected?: boolean; children: ReactNode; style?: CSSProperties }) {
  const theme = useContext(ThemeCtx)
  const t = TONES[theme]
  return (
    <div className="absolute" style={{ left: x, top: y, width: nw * s, height: nh * s, ...style }}>
      <div className="absolute bottom-full left-0 pb-1">
        {selected || theme === "dark" ? (
          <PillToggleToolbar componentName={name} nodeId={name} selected={!!selected} onSeeCode={() => {}} />
        ) : (
          // The app's unselected label is white at 30%, made for its dark canvas; on the light page, the same label in grey.
          <span className="flex h-9 items-center py-[5px] pr-3 text-xs font-medium whitespace-nowrap" style={{ color: t.label }}>
            {name}
          </span>
        )}
      </div>
      <div className={cn("absolute inset-0 overflow-hidden rounded-[4px]", t.shadow)}>
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

/** An Antidraw agent's cursor, in that agent's colour. */
function AgentCursor({ x, y, color, opacity }: { x: MotionValue<number>; y: MotionValue<number>; color: string; opacity?: MotionValue<number> }) {
  return (
    <motion.div className="pointer-events-none absolute top-0 left-0 z-50" style={{ x, y, opacity }}>
      <svg width="22" height="22" viewBox="0 0 22 22" className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]">
        <path d="M3 2.5 L3 17.5 L7.2 13.6 L10.1 19.6 L12.6 18.4 L9.8 12.6 L15.5 12.4 Z" fill={color} stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <div className="absolute top-[18px] left-[14px] flex items-center gap-1 rounded-[5px] px-1.5 py-[3px] text-[11px] font-semibold whitespace-nowrap text-white shadow-[0_2px_8px_rgba(0,0,0,0.25)]" style={{ background: color }}>
        <AgentIcon size={12} />
        Antidraw
      </div>
    </motion.div>
  )
}

/** A comment pin (open: blue; resolved: a green check) with your note beside it, or below it (`below`; `"left"` hangs it to the pin's left) to keep what it points at, and its neighbours, in view. */
function Thread({ x, y, text, open, resolved, below }: { x: number; y: number; text: string; open: MotionValue<number>; resolved?: boolean; below?: boolean | "left" }) {
  const scale = useTransform(open, (v) => 0.7 + 0.3 * v)
  return (
    <motion.div className="absolute z-10" style={{ left: x, top: y, opacity: open, scale }}>
      <span
        className={cn(
          "absolute grid size-5 -translate-y-full place-items-center rounded-full rounded-bl-none text-white shadow-[0_2px_6px_rgba(0,0,0,.35)] ring-2 ring-white/90 transition-colors duration-300",
          resolved ? "bg-[#22c55e]" : "bg-[#3b82f6]",
        )}
      >
        {resolved && <Check className="size-3" strokeWidth={3} />}
      </span>
      <div className={cn("absolute w-[196px]", below === "left" ? "top-6 right-0" : below ? "top-3 -left-2" : "top-[-30px] left-7")}>
      <div className="w-full rounded-[10px] bg-[#2b2b2b] px-3 py-2 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.08]">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-white/55">
          You
          {resolved && <span className="ml-auto text-[#4ade80]">Resolved</span>}
        </div>
        <div className="min-h-[18px] text-[12.5px] leading-[1.4] text-white/90">{text}</div>
      </div>
      </div>
    </motion.div>
  )
}

const DropShadowIcon = () => (
  <span className="relative block size-3.5">
    <span className="absolute top-1 left-1 size-2.5 rounded-[2px] bg-current opacity-30" />
    <span className="absolute top-0 left-0 size-2.5 rounded-[2px] border border-current" />
  </span>
)

function Sides({ h, v, scrub }: { h: number; v: number; scrub?: boolean }) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-1">
      <div className="grid flex-1 grid-cols-2 gap-1.5">
        <Num label="↔" value={h} scrub={scrub} flash={scrub} />
        <Num label="↕" value={v} scrub={scrub} flash={scrub} />
      </div>
      <IconBtn>
        <Scan />
      </IconBtn>
    </div>
  )
}

/** The Round-ups card's sections, as the app's Design panel shows a picked element (as in UseCaseAntidrawTour). */
function CardSections({ pad, fill, scrub }: { pad: number; fill: string; scrub: boolean }) {
  return (
    <Sections>
      <Section title="Auto layout" dirty={pad !== 16}>
        <Seg options={FLOW_OPTS} value="column" />
        <div className="flex gap-1.5">
          <SizeField axis="W" value={260} />
          <SizeField axis="H" value={cardH(pad, 18)} mode="hug" />
        </div>
        <div className="flex items-start gap-2">
          <AlignPad dir="column" jx={0} jy={0} />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex items-center gap-1">
              <Num label="↕" value={0} className="flex-1" />
              <IconBtn>
                <ChevronDown className="!size-3.5" />
              </IconBtn>
            </div>
            <div data-pad>
              <Sides h={pad} v={pad} scrub={scrub} />
            </div>
          </div>
        </div>
      </Section>
      <Section title="Appearance" actions={<EyeBtn />}>
        <div className="flex flex-wrap gap-2">
          <div className="min-w-0 flex-1">
            <Num label={<span className="text-[13px]">◐</span>} value={100} unit="%" />
          </div>
          <div className="min-w-0 flex-1">
            <Num label={<Corner />} value={18} />
          </div>
        </div>
      </Section>
      <Section title="Fill" dirty={fill !== "#FFFFFF"}>
        <div data-fill>
          <ColorRow hex={fill} right={<RemoveBtn />} />
        </div>
      </Section>
      <Section title="Stroke" empty actions={<Add />} />
      <Section title="Effects">
        <div className="flex items-center gap-1">
          <IconBtn>
            <DropShadowIcon />
          </IconBtn>
          <div className="flex h-7 min-w-0 flex-1 items-center rounded-[6px] px-2 text-[12px]" style={{ background: K.field, color: K.text }}>
            <span className="flex-1 truncate">Drop shadow</span>
          </div>
          <RemoveBtn />
        </div>
      </Section>
    </Sections>
  )
}


/* ── Layout (world px around the screen's centre, at 1440×900) ──────── */

/** Websites and posters are shown at these scales: 960×600 → 307×192, 360×480 → 180×240. */
const SITE_S = 0.32
const POSTER_S = 0.5
// Mirrored about x = 0: the phones in the middle (the Design panel in the gap between them), a website over a poster on each side.
const BLOOM = { x: -667, y: -110 }
const GLOW = { x: -667, y: 120 }
/** ColumnGlow's DialKit panel, beside its frame. */
const DIAL = { x: -476, y: 120, s: 0.55 }
const ORBIT = { x: 360, y: -110 }
// The right side's lower half, mirroring the glow and its panel: the Tidepod player, then a boarding card over a poster.
const PLAYER = { x: 360, y: 120, s: 0.5 }
const BOARD = { x: 523, y: 120, s: 0.48 }
const PASTEL = { x: 523, y: 238, s: 0.4 }
const SPROUT = { x: -300, y: -30 }
/** The app's panel at its natural 280px, scaled to fit the 228px gap between the inner frames. */
const PANEL = { x: -98, y: -26, w: 280, s: 0.7 }
const FERN = { x: 114, y: -30 }
/** The title block, centred above the frames; `h` is its height at 1×, three lines and the buttons. */
const TITLE = { w: 480, y: -353, h: 182 }
/** The lowest frame's foot, PastelPoster's: the canvas reaches this far below its centre. */
const CANVAS_FOOT = 430

/* ── You: precise edits, then two comments (16s) ────────────────────── */

const LIME = "#C6F432"
const T = {
  period: 16,
  pick: 1.1,
  pad: [2.0, 3.0],
  fill: [3.7, 4.6],
  apply: 5.5,
  applied: 7.2,
  bloom: [7.8, 8.2, 9.2],
  fern: [9.5, 10.0, 11.3],
  violet: [11.6, 12.3],
  lilac: [12.4, 13.0],
  bloomDone: 13.1,
  green: [12.3, 13.0],
  greenOn: [13.1, 13.6],
  fernDone: 13.7,
  reset: [15.1, 15.6],
} as const
const BLOOM_NOTE = "Make the hero lilac"
const FERN_NOTE = "Green button, say “Book 2 nights”"

function YouStory() {
  const t = useLoop(T.period)
  const back = (x: number) => 1 - ramp(x, T.reset[0], T.reset[1])

  // Precise edits on SproutHome.
  const pad = useStep(t, (x) => Math.round(mix(16, 24, ramp(x, T.pad[0], T.pad[1]) * back(x))))
  const fillP = useStep(t, (x) => Math.round(ramp(x, T.fill[0], T.fill[1]) * back(x) * 20) / 20)
  const fill = lerpHex("#FFFFFF", LIME, fillP)
  const picked = useStep(t, (x) => x >= T.pick && x < T.applied)
  const panel = useOn(t, (x) => kf(x, [[T.pick, 0], [T.pick + 0.25, 1], [T.applied, 1], [T.applied + 0.3, 0]]))
  const n = useStep(t, (x) => (x >= T.apply + 0.15 ? 0 : x >= T.fill[0] ? 2 : x >= T.pad[0] ? 1 : 0))
  const hover = useOn(t, (s) => ramp(s, 0.75, 0.9) * (1 - ramp(s, T.pick, T.pick + 0.1)))
  const card = cardRect(pad, 18)

  // The two comments, and the agents that take them.
  const mPin: [number, number] = [BLOOM.x + (BLOOM_HEAD.x + 150) * SITE_S, BLOOM.y + BLOOM_HEAD.y * SITE_S]
  const fPin: [number, number] = [FERN.x + FW - 42, FERN.y + FH - 26]
  const mOpen = useOn(t, (x) => ramp(x, T.bloom[1] - 0.1, T.bloom[1] + 0.1) * back(x))
  const fOpen = useOn(t, (x) => ramp(x, T.fern[1] - 0.1, T.fern[1] + 0.1) * back(x))
  const mText = useStep(t, (x) => typedAt(x, T.bloom[1], T.bloom[2], BLOOM_NOTE))
  const fText = useStep(t, (x) => typedAt(x, T.fern[1], T.fern[2], FERN_NOTE))
  const lilac = useStep(t, (x) => Math.round(ramp(x, T.lilac[0], T.lilac[1]) * back(x) * 20) / 20)
  const green = useStep(t, (x) => Math.round(ramp(x, T.greenOn[0], T.greenOn[1]) * back(x) * 20) / 20)
  const mDone = useStep(t, (x) => x >= T.bloomDone)
  const fDone = useStep(t, (x) => x >= T.fernDone)

  // Your cursor: the card, the panel's Pad and Fill, then each comment's spot.
  const cx = SPROUT.x + (card.x + card.w / 2) * S
  const cy = SPROUT.y + (card.y + 40) * S
  // The Padding ↔ field and the Fill swatch, at their spots in the panel (natural px × its scale).
  const padF: [number, number] = [PANEL.x + 128 * PANEL.s, PANEL.y + 204 * PANEL.s]
  const fillF: [number, number] = [PANEL.x + 26 * PANEL.s, PANEL.y + 374 * PANEL.s]
  const you = usePath(t, [
    [0, SPROUT.x + 80, SPROUT.y + 250],
    [0.9, cx, cy],
    [T.pick + 0.2, cx, cy],
    [T.pad[0] - 0.1, ...padF],
    [T.pad[1], padF[0] + 24, padF[1]],
    [T.fill[0] - 0.15, ...fillF],
    [T.fill[1], fillF[0] + 40, fillF[1] + 2],
    [T.apply + 0.6, SPROUT.x + 120, SPROUT.y + 230],
    [T.bloom[1], mPin[0] + 2, mPin[1] - 2],
    [T.bloom[2], mPin[0] + 2, mPin[1] - 2],
    [T.fern[1], fPin[0] + 2, fPin[1] - 2],
    [T.fern[2] + 0.4, fPin[0] + 2, fPin[1] - 2],
    [14.4, SPROUT.x + 80, SPROUT.y + 250],
    [T.period, SPROUT.x + 80, SPROUT.y + 250],
  ])
  const violet = usePath(t, [
    [0, BLOOM.x + 150, BLOOM.y - 50],
    [T.violet[0], BLOOM.x + 150, BLOOM.y - 50],
    [T.violet[1], BLOOM.x + 200, BLOOM.y + 60],
    [T.lilac[1], BLOOM.x + 250, BLOOM.y + 90],
    [T.bloomDone + 0.6, BLOOM.x + 170, BLOOM.y - 50],
    [T.period, BLOOM.x + 150, BLOOM.y - 50],
  ])
  const violetOp = useOn(t, (x) => kf(x, [[T.violet[0], 0], [T.violet[0] + 0.3, 1], [T.bloomDone + 0.3, 1], [T.bloomDone + 0.6, 0]]))
  const greenA = usePath(t, [
    [0, FERN.x + FW + 140, FERN.y + 160],
    [T.green[0], FERN.x + FW + 140, FERN.y + 160],
    [T.green[1], FERN.x + FW - 70, FERN.y + FH - 40],
    [T.greenOn[1], FERN.x + FW - 60, FERN.y + FH - 34],
    [T.fernDone + 0.7, FERN.x + FW + 140, FERN.y + 200],
    [T.period, FERN.x + FW + 140, FERN.y + 160],
  ])
  const greenOp = useOn(t, (x) => kf(x, [[T.green[0], 0], [T.green[0] + 0.3, 1], [T.fernDone + 0.4, 1], [T.fernDone + 0.7, 0]]))

  return (
    <>
      <CanvasFrame name="BloomSite" x={BLOOM.x} y={BLOOM.y} nw={SITE_W} nh={SITE_H} s={SITE_S} selected={lilac > 0 && lilac < 1}>
        <BloomSite lilac={lilac} />
      </CanvasFrame>
      <CanvasFrame name="SproutHome" x={SPROUT.x} y={SPROUT.y} selected={picked}>
        <SproutHome pad={pad} fill={fill} size={18} />
        <motion.div className="pointer-events-none absolute rounded-[18px] bg-[#3b82f6]/15 ring-1 ring-[#3b82f6]/60" style={{ left: card.x, top: card.y, width: card.w, height: cardH(pad, 18), opacity: hover }} />
        {picked && <div className="pointer-events-none absolute rounded-[18px] ring-[3px] ring-[#3b82f6]" style={{ left: card.x, top: card.y, width: card.w, height: cardH(pad, 18) }} />}
      </CanvasFrame>
      <CanvasFrame name="FernhollowStay" x={FERN.x} y={FERN.y} selected={green > 0 && green < 1}>
        <FernhollowStay green={green} />
      </CanvasFrame>

      {/* Antidraw's own Design panel (usecase/design/panel.tsx, ported from the app's design/), for the picked card, scaled into the gap between the frames. */}
      <motion.div
        data-panel
        className="absolute z-10 overflow-hidden rounded-[12px] shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/[0.08]"
        style={{ left: PANEL.x, top: PANEL.y, width: PANEL.w, opacity: panel, scale: PANEL.s, transformOrigin: "0 0" }}
      >
        <RightPanelShell edited={n > 0} className="h-auto border-l-0">
          <CardSections pad={pad} fill={fill} scrub={pad !== 16 && pad !== 24} />
        </RightPanelShell>
      </motion.div>

      <Thread x={mPin[0]} y={mPin[1]} text={mText} open={mOpen} resolved={mDone} below />
      <Thread x={fPin[0]} y={fPin[1]} text={fText} open={fOpen} resolved={fDone} below="left" />
      <AgentCursor {...violet} color={AGENTS.violet} opacity={violetOp} />
      <AgentCursor {...greenA} color={AGENTS.green} opacity={greenOp} />
      <Cursor x={you.x} y={you.y} color="#ffffff" label="You" />
    </>
  )
}

/* ── Agents building, on their own loops ────────────────────────────── */

/** An agent builds a frame: a shimmer with its cursor working over it, then the frame fades up and holds. */
function Build({ name, at, nw, nh, s, color, period, offset = 0, children }: { name: string; at: { x: number; y: number }; nw: number; nh: number; s: number; color: string; period: number; offset?: number; children: ReactNode }) {
  const [w, h] = [nw * s, nh * s]
  const raw = useLoop(period)
  const t = useOn(raw, (x) => (x + offset) % period)
  const hold = period - 0.5
  const frame = useOn(t, (x) => kf(x, [[0, 0], [0.3, 1], [hold, 1], [period, 0]]))
  const scale = useOn(t, (x) => kf(x, [[0, 0.94], [0.4, 1, E.pop]]))
  const skel = useOn(t, (x) => kf(x, [[3.4, 1], [3.9, 0]]))
  const cur = usePath(t, [
    [0, at.x + 30, at.y - 60],
    [0.6, at.x + w * 0.2, at.y + h * 0.18],
    [1.3, at.x + w * 0.7, at.y + h * 0.4],
    [2.0, at.x + w * 0.3, at.y + h * 0.65],
    [2.8, at.x + w * 0.75, at.y + h * 0.8],
    [3.6, at.x + w * 0.5, at.y + h * 0.3],
    [4.6, at.x + 30, at.y - 60],
    [period, at.x + 30, at.y - 60],
  ])
  const op = useOn(t, (s) => kf(s, [[0, 0], [0.3, 1], [4.2, 1], [4.6, 0]]))
  return (
    <>
      <motion.div className="absolute" style={{ left: at.x, top: at.y, width: w, height: h, opacity: frame, scale }}>
        <CanvasFrame name={name} x={0} y={0} nw={nw} nh={nh} s={s}>
          {children}
          <motion.div className="absolute inset-0" style={{ opacity: skel }}>
            <Skeleton />
          </motion.div>
        </CanvasFrame>
      </motion.div>
      <AgentCursor {...cur} color={color} opacity={op} />
    </>
  )
}

/* ── ColumnGlow, tuned in DialKit (10s) ─────────────────────────────── */

/** The band behind the essay landing's tour (AntidrawLandingEssay's GLOW), with fewer columns for a small frame. */
const GLOW_BASE = { ...COLUMN_GLOW_DEFAULTS, columns: 40, stagger: 14 }
const G = { period: 10, swaps: [0, 2.5, 5, 7.5] }

/** A pink agent works the glow's DialKit panel: it flicks through the palettes, drags Arc and Glow blur, and the frame follows. */
function GlowTuning() {
  const t = useLoop(G.period)
  const pi = useStep(t, (x) => G.swaps.filter((s) => x >= s).length - 1)
  const arc = useStep(t, (x) => Math.round(kf(x, [[0.8, 38], [1.8, 62, E.inOut], [3.3, 62], [4.3, 18, E.inOut], [8.4, 18], [9.6, 38, E.inOut]])))
  const glow = useStep(t, (x) => Math.round(kf(x, [[5.6, 22], [6.6, 44, E.inOut], [8.0, 44], [9.0, 22, E.inOut]])))
  const hot = useStep(t, (x): "arc" | "glow" | "" => ((x > 0.8 && x < 1.9) || (x > 3.3 && x < 4.4) ? "arc" : x > 5.6 && x < 6.7 ? "glow" : ""))
  // Panel spots, in its natural px: the Palette row, the Arc and Glow blur sliders.
  const at = (nx: number, ny: number): [number, number] => [DIAL.x + nx * DIAL.s, DIAL.y + ny * DIAL.s]
  const sel = at(200, 62)
  const arcAt = (v: number) => at(110 + (v / 70) * 150, 136)
  const glowAt = (v: number) => at(110 + (v / 60) * 150, 172)
  const cur = usePath(t, [
    [0, ...sel],
    [0.6, ...arcAt(38)],
    [1.8, ...arcAt(62)],
    [2.4, ...sel],
    [3.2, ...arcAt(62)],
    [4.3, ...arcAt(18)],
    [4.9, ...sel],
    [5.5, ...glowAt(22)],
    [6.6, ...glowAt(44)],
    [7.4, ...sel],
    [G.period, ...sel],
  ])
  const colors = GLOW_PALETTES[pi].colors
  return (
    <>
      {/* The essay landing's glowing columns, as a piece on the canvas. */}
      <CanvasFrame name="ColumnGlow" x={GLOW.x} y={GLOW.y} nw={POSTER_W} nh={POSTER_H} s={POSTER_S}>
        <div className="absolute inset-0">
          <ColumnGlow {...GLOW_BASE} colors={colors} arc={arc} glow={glow} className="h-full w-full" />
        </div>
      </CanvasFrame>
      <div className="absolute z-10 origin-top-left" style={{ left: DIAL.x, top: DIAL.y, width: DIAL_W, transform: `scale(${DIAL.s})` }}>
        <GlowDial palette={GLOW_PALETTES[pi].name} columns={GLOW_BASE.columns} arc={arc} glow={glow} hot={hot || null} />
      </div>
      <AgentCursor {...cur} color={AGENTS.pink} />
    </>
  )
}

/** The Tidepod player, its scrubber running. */
function Player() {
  const t = useLoop(30)
  const progress = useStep(t, (x) => Math.round((0.18 + (x / 30) * 0.5) * 400) / 400)
  return (
    <CanvasFrame name="TidepodPlayer" x={PLAYER.x} y={PLAYER.y} nw={PLAYER_W} nh={PLAYER_H} s={PLAYER.s}>
      <TidepodPlayer progress={progress} />
    </CanvasFrame>
  )
}

/* ── Page ───────────────────────────────────────────────────────────── */

/** The page's ground and the scrollbar's thumb on it, per theme. */
const PAGE_BG = { dark: "#232323", light: "#f5f5f4" }
const SCROLL = { dark: "rgba(255,255,255,0.18)", light: "rgba(0,0,0,0.2)" }

const DRIFT = { x: [0, -36, 18, 0], y: [0, 16, -12, 0] }

/** The canvas landing in either theme (AntidrawLandingCanvasLight renders the light one). */
/**
 * `hero` replaces the title and buttons (LaunchCanvasHero puts the founder's video there); `scale`
 * fixes the zoom instead of fitting the window, and the page then fills its parent, not the screen.
 * `bare` is the canvas alone — no title, navbar or zoom readout — for showing it inside an app
 * window (LaunchComposer). `full` makes it the whole page: the canvas is its first screen, the essay
 * landing's sections (landing/EssaySections) follow it, then the footer in `footer`'s style (landing/Footers):
 * by default the last call, "start on the canvas.", over the columns.
 */
export function CanvasLanding({ theme = "dark", hero, scale, bare = false, full = false, footer = "closeColumns" }: { theme?: Theme; hero?: ReactNode; scale?: number; bare?: boolean; full?: boolean; footer?: FooterStyle }) {
  const tone = TONES[theme]
  const [fit, width] = useStageScale()
  const k = scale ?? fit
  // Below md the title leaves the canvas: it sits under the navbar at its own size, and the canvas moves down to clear it.
  const narrow = !scale && width < 768
  // Above it, the title's scale doesn't drop below 0.75 as the canvas shrinks, so it stays legible on a tablet. It grows upward: its bottom stays where the canvas puts it.
  const kt = scale ? k : Math.max(k, 0.75)
  const title = (
    <>
      <h1 className={cn("font-medium tracking-[-0.025em] text-balance", narrow ? "text-[26px]" : "text-[32px]", "leading-[1.1]")} style={{ fontVariationSettings: '"opsz" 32' }}>
        product design &amp; prototyping {!narrow && <br />}
        canvas for your coding agents {!narrow && <br />}
        powered by real code.
      </h1>
      <div data-hero-cta className={cn("mt-8 flex flex-wrap items-center justify-center gap-2.5", narrow && "mx-auto max-w-[340px] flex-col items-stretch")}>
        <DownloadButton theme={theme} stretch={narrow} icon={<AppleMark />} />
        <a href={REPO} target="_blank" rel="noreferrer" className={cn("inline-flex h-11 items-center justify-center gap-2 border px-5 text-[15px] font-medium transition-colors", tone.ghost)}>
          <GithubMark />
          Star on GitHub
        </a>
      </div>
    </>
  )
  // The canvas's centre: the screen's, or low enough on a phone to clear the title.
  // The hero is as tall as the screen, up to what the canvas needs at this zoom: the title above the centre
  // (clear of the navbar) and the frames below it (down to PastelPoster's foot, 430 world px). In a window
  // narrower than it is tall the zoom is set by the width, and a full-height hero would leave a band of
  // empty canvas over the title and under the frames; capped, the title starts just under the navbar and
  // the next section follows the frames. The centre splits the hero in the same proportion, title to frames.
  const above = -(TITLE.y + TITLE.h) * k + TITLE.h * kt + NAV_H + 32
  const below = CANVAS_FOOT * k + 24
  const centre = narrow ? "max(50%, 480px)" : `${((above / (above + below)) * 100).toFixed(2)}%`
  const heroH = narrow ? `${Math.round(480 + below)}px` : `min(100vh, ${Math.round(Math.max(680, above + below))}px)`
  // The page's scrollbar in its own colours: a faint thumb on the page, no light track beside the dark page.
  // The document behind it in the page's colour too, so scrolling past either end (the bounce) shows the page, not black.
  useEffect(() => {
    if (!full) return
    const root = document.documentElement.style
    const was = { scheme: root.colorScheme, color: root.scrollbarColor, bg: root.backgroundColor }
    root.colorScheme = theme
    root.scrollbarColor = `${SCROLL[theme]} ${PAGE_BG[theme]}`
    root.backgroundColor = PAGE_BG[theme]
    return () => {
      root.colorScheme = was.scheme
      root.scrollbarColor = was.color
      root.backgroundColor = was.bg
    }
  }, [full, theme])
  const canvas = (
    <div className={cn("relative overflow-hidden antialiased", scale && "h-full", tone.page)} style={{ fontFamily: fontStack("schibsted"), height: scale ? undefined : heroH }}>
      <LandingFontFaces />

      {/* The canvas: plain and drifting, the frames placed around the screen's centre. */}
      <motion.div className="absolute left-1/2" style={{ top: centre }} animate={DRIFT} transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}>
        <div style={{ transform: `scale(${k})`, transformOrigin: "0 0" }}>
          <div aria-hidden className="font-sans">
            <Build name="OrbitSite" at={ORBIT} nw={SITE_W} nh={SITE_H} s={SITE_S} color={AGENTS.blue} period={8}>
              <OrbitSite />
            </Build>
            <GlowTuning />
            <Player />
            <CanvasFrame name="BoardingCard" x={BOARD.x} y={BOARD.y} nw={BOARD_W} nh={BOARD_H} s={BOARD.s}>
              <BoardingCard />
            </CanvasFrame>
            <CanvasFrame name="PastelPoster" x={PASTEL.x} y={PASTEL.y} nw={POSTER_W} nh={POSTER_H} s={PASTEL.s}>
              <PastelPoster />
            </CanvasFrame>
            <YouStory />
          </div>

        </div>
      </motion.div>
      {narrow && !bare && !hero ? (
        <main className="absolute inset-x-0 z-20 px-5 text-center" style={{ top: NAV_H + 48 }}>
          {title}
        </main>
      ) : (
        <div className="absolute left-1/2 z-20" style={{ top: centre }}>
          <div style={{ transform: `scale(${kt})`, transformOrigin: "0 0" }}>
            {/* The title, placed on the canvas above the frames but held still: it doesn't drift with them. */}
            {bare ? null : hero ?? <main className="absolute text-center" style={{ left: -TITLE.w / 2, top: ((TITLE.y + TITLE.h) * k) / kt - TITLE.h, width: TITLE.w }}>{title}</main>}
          </div>
        </div>
      )}

      {/* The canvas's own controls: the zoom at the bottom right (not on the landing page). */}
      {!bare && !full && <div className="absolute right-5 bottom-5 z-30 rounded-[10px] bg-[#262626] px-3 py-1.5 font-sans text-[12px] text-white/60 tabular-nums shadow-[0_4px_16px_rgba(0,0,0,.4),0_0_0_1px_rgba(255,255,255,.06)]">
        {Math.round(k * 100)}%
      </div>}

      {!bare && <EssayNav theme={theme} menu="mega" instant shrink cta="always" blur={false} badge="Alpha" github={REPO} download={DOWNLOADS.silicon} githubIcon={<GithubMark className="size-[18px]" />} downloadIcon={<AppleMark className="size-[14px]" />} />}
    </div>
  )
  return (
    <ThemeCtx.Provider value={theme}>
      {full ? (
        <div className={cn("antialiased", tone.page)} style={{ fontFamily: fontStack("schibsted"), "--landing-page": PAGE_BG[theme] } as CSSProperties}>
          {canvas}
          {/* Set against the hero's 32px title: no heading below outgrows it. */}
          <TypeScaleCtx.Provider value="compact">
            <main className="px-5 sm:px-16">
              <EssaySections theme={theme} first="mt-16 sm:mt-24" />
              <LandingFooter style={footer} theme={theme} className="mt-32" />
            </main>
          </TypeScaleCtx.Provider>
        </div>
      ) : (
        canvas
      )}
    </ThemeCtx.Provider>
  )
}

export default function AntidrawLandingCanvas() {
  return <CanvasLanding full />
}
