/**
 * Designers · "Responsive for real": resize the frame and the layout reflows
 * the way it will in the browser, so there's no mobile, tablet and desktop
 * copy of every screen to draw.
 *
 * One frame on a transparent stage, no chat: the page is a real component,
 * so the resize alone tells it.
 *   0–1.4s     CoffeeCollection (Halcyon's shop page) sits on the canvas at
 *              desktop width: nav links, a filter sidebar, three columns of
 *              coffees. The designer clicks it: blue outline, handles and the
 *              frame's toolbar.
 *   2.25–4.6s  They grab the bottom-right handle and drag in to 768. The
 *              sidebar folds up into a bar of roast chips, the one-line
 *              headline rewraps to two, then the grid goes from three columns
 *              to two (the cards that change rows lift and slide over).
 *   4.75–6.5s  Let go: a pause at tablet width. They pan the canvas (two
 *              fingers on the trackpad) so the frame sits in the middle again.
 *   6.5–8.85s  Grab the handle again, drag in to 390. The nav links give way to a menu
 *              button and the logo moves to the middle, the grid goes to one
 *              column, the type steps down and the copy rewraps.
 *   9–10.15s   Let go, and pan the frame back to the middle again.
 *   10.8–13s   They try the phone menu for real: it opens as a sheet with the
 *              nav links, then closes.
 *   13.7s–     Held on the phone layout, then a fade through the loop seam.
 *
 * The resize works like the app's (React Flow NodeResizer): the opposite
 * corner stays put, and the canvas pans afterwards to keep things balanced.
 * Page and layout: usecase/design/responsive.tsx.
 */
import type { ReactNode } from "react"
import { cubicBezier, motion } from "motion/react"

import { Camera, Cursor, E, Frame, Scene, ScenePage, kf, path, ramp, useAt, useTrack, type Ease, type PathKey } from "../motion/canvas-ai/kit"
import { CoffeeCollection, PAGE_H, menuButtonAt } from "../usecase/design/responsive"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 16.6
const STILL = 15.2

const NAME = "CoffeeCollection"
const T = { select: 1.2, grab1: 2.25, rel1: 4.75, grab2: 6.5, rel2: 9.0, menu: 10.8, close: 12.6 }
const DRAG1 = [2.4, 4.6] as const
const DRAG2 = [6.65, 8.85] as const
/** Two-finger pans on the trackpad (the canvas pans on scroll) that bring the frame back to the middle. */
const PAN1 = [5.0, 5.9] as const
const PAN2 = [9.25, 10.15] as const
const OPEN = [10.85, 11.3] as const
const SHUT = [12.65, 13.05] as const

/* ── Layout ───────────────────────────────────────────────────────────── */

/** Page px → stage px. */
const S = 0.8
const CX = W / 2
const FRAME_Y = 98
const FRAME_H = PAGE_H * S
/** The frame's left edge on the canvas: it starts centred at desktop width, and the resize keeps it put. */
const FRAME_X = CX - (1280 * S) / 2

/** The frame's width in page px: desktop, a pause at tablet, then phone. */
const DRAG = cubicBezier(0.45, 0, 0.3, 1) as Ease
const vwAt = (t: number) => kf(t, [[0, 1280], [DRAG1[0], 1280], [DRAG1[1], 768, DRAG], [DRAG2[0], 768], [DRAG2[1], 390, DRAG]])
/** How far the canvas has panned right so a frame of width `vw` sits in the middle again. */
const recentre = (vw: number) => CX - (FRAME_X + (vw * S) / 2)
const panAt = (t: number) => kf(t, [[0, 0], [PAN1[0], 0], [PAN1[1], recentre(768), E.inOut], [PAN2[0], recentre(768)], [PAN2[1], recentre(390), E.inOut]])
/** The bottom-right handle in stage px, with the canvas panned by `pan` (the pointer's tip sits on it). */
const handle = (vw: number, pan: number): [number, number] => [FRAME_X + pan + vw * S - 2, FRAME_Y + FRAME_H - 2]
const MENU_AT: [number, number] = [FRAME_X + recentre(390) + menuButtonAt(390)[0] * S, FRAME_Y + menuButtonAt(390)[1] * S]
const REST: [number, number] = [900, 610]

const YOU: PathKey[] = [
  [0, 1010, 700],
  [T.select - 0.55, 1010, 700],
  [T.select - 0.05, 860, 520, E.inOut],
  [T.select + 0.2, 860, 520],
  [T.grab1 - 0.05, ...handle(1280, 0), E.inOut],
  [DRAG1[0], ...handle(1280, 0)],
  [DRAG1[1], ...handle(768, 0)],
  // The pointer rests while the canvas pans under it, then finds the handle again.
  [PAN1[1] + 0.1, ...handle(768, 0)],
  [T.grab2 - 0.05, ...handle(768, recentre(768)), E.inOut],
  [DRAG2[0], ...handle(768, recentre(768))],
  [DRAG2[1], ...handle(390, recentre(768))],
  [PAN2[1] + 0.1, ...handle(390, recentre(768))],
  [T.menu - 0.1, ...MENU_AT, E.inOut],
  [T.menu + 0.3, ...MENU_AT],
  [11.9, MENU_AT[0] + 46, MENU_AT[1] + 70, E.inOut],
  [T.close - 0.1, ...MENU_AT, E.inOut],
  [T.close + 0.3, ...MENU_AT],
  [13.7, ...REST, E.inOut],
  [DUR, ...REST],
]
const inDrag = (t: number) => (t >= DRAG1[0] && t <= DRAG1[1]) || (t >= DRAG2[0] && t <= DRAG2[1])
/** While dragging, the pointer rides the handle exactly. */
const pointer = (t: number) => (inDrag(t) ? handle(vwAt(t), panAt(t)) : path(t, YOU))
const CLICKS = [T.select, T.menu, T.close]
const held = (t: number) => (t >= T.grab1 && t < T.rel1) || (t >= T.grab2 && t < T.rel2)

/* ── Pieces ───────────────────────────────────────────────────────────── */

/** The canvas at 1:1 (the kit's Frame label, outline and handles sit in stage px), panned by panAt. */
const cam = (t: number) => ({ x: W / 2 - panAt(t), y: H / 2, s: 1 })

function Page() {
  const vw = useAt((t) => Math.round(vwAt(t)))
  const selected = useAt((t) => t >= T.select)
  const menu = useAt((t) => Math.round((ramp(t, OPEN[0], OPEN[1], E.out) - ramp(t, SHUT[0], SHUT[1], E.inOut)) * 40) / 40)
  return (
    <Camera cam={cam}>
      <Frame name={NAME} x={FRAME_X} y={FRAME_Y} w={vw * S} h={FRAME_H} selected={selected} className="shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)]">
        <div className="origin-top-left" style={{ width: vw, height: PAGE_H, transform: `scale(${S})` }}>
          <CoffeeCollection vw={vw} menu={menu} />
        </div>
      </Frame>
    </Camera>
  )
}

function Pointer() {
  const x = useTrack((t) => pointer(t)[0])
  const y = useTrack((t) => pointer(t)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6) * (1 - ramp(t, 13.9, 14.3)))
  const press = useTrack((t) => 1 - 0.16 * Math.max(...CLICKS.map((c) => Math.sin(Math.PI * ramp(t, c - 0.08, c + 0.12, E.linear))), held(t) ? 0.6 : 0))
  return <Cursor x={x} y={y} opacity={opacity} press={press} />
}

function Fade({ children }: { children: ReactNode }) {
  const opacity = useTrack((t) => (t < 1 ? kf(t, [[0, 0], [0.3, 1]]) : kf(t, [[DUR - 0.6, 1], [DUR, 0]])))
  return (
    <motion.div className="absolute inset-0" style={{ opacity }}>
      {children}
    </motion.div>
  )
}

export function UseCaseDesignResponsiveScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Page />
        <Pointer />
      </Fade>
    </Scene>
  )
}

export default function UseCaseDesignResponsive() {
  return (
    <ScenePage label="Designers · Responsive for real">
      <UseCaseDesignResponsiveScene />
    </ScenePage>
  )
}
