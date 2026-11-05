/**
 * UseCaseAntidrawTour — the whole Antidraw app in one loop, for the essay landing: the chat on the
 * left, the canvas with several real components on it, the Design / Comments panel on the right.
 *
 * Each act runs in its own chat thread (the app's SidePanel: a "Chats / title" breadcrumb with a +, and
 * the Chats list between threads), so it shows several conversations side by side in one workspace.
 *
 * Acts (42s loop; the scene fades through the seam, which resets every change):
 *  0.0   Overview: MuseumHome, SproutHome and FernhollowStay on the canvas, the chat that made them.
 *  2.4   Variations. The designer asks for two more takes on FernhollowStay; the camera moves over
 *        and FernhollowLake and FernhollowNight shimmer in beside it, the Antidraw cursor building them.
 *  9.1   A new chat (+). Then precise edits. Inspect on SproutHome: pick the Round-ups card, scrub its padding 16 → 24,
 *        drag its fill to sprout lime; the Precise edits bar counts them, Apply to code hands them to
 *        the agent, and its Edit writes them into SproutHome.tsx as a diff.
 * 19.6   The Chats list; New. Then comments. The Comment tool on FernhollowStay: two notes pinned (title bolder; a green
 *        "Book 2 nights" button), sent together; the agent fixes and marks each; Resolved shows its notes.
 * 30.8   View code. Back to the pointer, FernhollowStay selected, See Code in its toolbar: the read-only
 *        viewer slides in with the frame's real source (fernhollow.tsx) and scrolls; closed at 35.6.
 * 36.4   The Chats list again, now with all three threads; the camera pulls back over all five frames.
 *
 * Real app pieces from usecase/design/ (ported from packages/shell/src/renderer): ChatPanel, Composer,
 * UserBubble, ToolGroup/ToolRow (the panel's header and Chats list follow SidePanel.tsx, the empty
 * thread ChatEmptyState.tsx), DiffLines (chat.tsx); RightPanelShell, the Design sections, Picker,
 * EditBar (panel.tsx); CodePanel (code.tsx, components/CodeSidePanel.tsx); OutboxCard, NotSentFoot, CommentBox, Pin (comments.tsx); CanvasTools, Crosshair,
 * HoverBoxes, PickOutline (canvas.tsx). Frames: MuseumHome (motion/make/museum.tsx), SproutHome
 * (sprout.tsx), FernhollowStay (fernhollow.tsx). ?motionT=<s> freezes a moment.
 */
import { motion } from "motion/react"
import { ArrowLeft, ChevronDown, Plus, Scan, Search } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { Camera, Cursor, E, Frame, Scene, ScenePage, Skeleton, WorldCursor, kf, mix, path, ramp, typed, useAt, useTrack, type Cam, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Composer, DiffLines, Field, Reveal, ToolGroup, ToolRow, UserBubble, Working, type DiffLine } from "../usecase/design/chat"
import { CanvasTools, Crosshair, HoverBoxes, KeyHint, PickOutline } from "../usecase/design/canvas"
import {
  Add,
  AlignPad,
  ColorRow,
  Corner,
  EditBar,
  EyeBtn,
  FLOW_OPTS,
  IconBtn,
  Num,
  Picker,
  RemoveBtn,
  RightPanelShell,
  Section,
  Sections,
  Seg,
  SelectEmpty,
  SizeField,
  T as K,
  hsvToHex,
  type BarElement,
  type HSV,
} from "../usecase/design/panel"
import { BOX, CommentBox, NotSentFoot, OutboxCard, OutboxFilter, Pin } from "../usecase/design/comments"
import { SproutHome, cardH, cardRect } from "../usecase/design/sprout"
import { FernhollowStay } from "../usecase/design/fernhollow"
import { MuseumHome } from "../motion/make/museum"
import { MotionSeek } from "../usecase/ecosystem/seek"
import { CodePanel } from "../usecase/design/code"
import fernRaw from "../usecase/design/fernhollow.tsx?raw"

const W = 1280
const H = 720
const DUR = 42
const STILL = 33.8
// The chat side panel (SidePanel.tsx defaults to 500 in the app; 400 on this 1280 stage).
const CHAT_W = 400
const PANEL_W = 280
const PANEL_X = W - PANEL_W
const CANVAS_W = PANEL_X - CHAT_W
/** The canvas's centre sits right of the stage's by this much. */
const OFF = (CHAT_W - PANEL_W) / 2

// Frames, in world coords (each 300×600).
const MUSEUM = -380
const SPROUT = 0
const FERN = 380
const VARS = [
  { name: "FernhollowLake", x: 760, lake: 1, night: false, row: [5.7, 7.4] as const },
  { name: "FernhollowNight", x: 1140, lake: 0, night: true, row: [6.4, 8.2] as const },
]
const FRAME_XS = [MUSEUM, SPROUT, FERN, ...VARS.map((v) => v.x)]

/* ── Timeline ───────────────────────────────────────────────────────── */

const PROMPT = "Make two more takes on FernhollowStay: one by the lake, one for night."
const A1 = { click: 2.4, type: [2.6, 4.9] as const, send: 5.25, reply: 8.5 }
const A2 = {
  tool: 10.0,
  hoverCard: 10.9,
  pickCard: 11.15,
  scrubA: 12.2,
  scrubB: 13.05,
  swatch: 13.75,
  hue: 14.3,
  svA: 14.6,
  svB: 15.25,
  esc: 15.5,
  list: 16.2,
  apply: 16.9,
  edit: 17.35,
  editDone: 18.6,
  final: 18.85,
}
type C = { at: [number, number]; text: string; click: number; a: number; b: number; enter: number; element: string; note: string; edit: number; done: number; mark: number; agent: [number, number] }
const COMMENTS: C[] = [
  { at: [120, 288], text: "Make the title bolder, it's getting lost.", click: 22.2, a: 22.3, b: 23.2, enter: 23.35, element: "div.mt-1.5", note: "Title is 30px and extra bold now.", edit: 26.6, done: 27.3, mark: 27.7, agent: [150, 300] },
  { at: [238, 556], text: 'Say "Book 2 nights", and make it green.', click: 23.9, a: 24.0, b: 25.0, enter: 25.15, element: "span.flex", note: "Button reads Book 2 nights, in forest green.", edit: 27.9, done: 28.6, mark: 29.0, agent: [250, 565] },
]
const A3 = { tool: 21.4, send: 25.9, intro: 26.2, final: 29.3, resolved: 30.0 }
const A4 = { pointer: 30.8, select: 31.5, see: 32.15, close: 35.6 }
const BACK = [36.4, 37.8] as const
// Threads: a new chat before the edits; the Chats list, then New, before the comments; the list at the end.
const TH = { new1: 9.1, list1: 19.6, new2: 20.5, list2: 36.6 }

const toolAt = (t: number) => (t >= A4.pointer ? "pointer" : t >= A3.tool ? "comment" : t >= A2.tool ? "inspect" : "pointer")

// The viewer shows the frame's real source, its doc comment dropped.
const FERN_CODE = fernRaw.replace(/^\/\*\*[\s\S]*?\*\/\n/, "").trim()
const CODE_W = 420

/* ── Camera ─────────────────────────────────────────────────────────── */

// The world point at the canvas's centre, and the zoom.
const cam = (t: number): Cam => {
  const s = kf(t, [[0, 0.54], [9.4, 0.54], [10.4, 1, E.cam], [BACK[0], 1], [BACK[1], 0.3, E.cam]])
  // While the code viewer is open, the frame moves to the middle of the canvas left of it.
  const cx = kf(t, [[0, 150], [5.6, 150], [6.6, 910, E.cam], [9.4, 910], [10.4, 150, E.cam], [19.6, 150], [20.6, 530, E.cam], [A4.see, 530], [A4.see + 0.6, 600, E.cam], [BACK[0], 600], [BACK[1], 530, E.cam]])
  const cy = kf(t, [[0, 300], [9.4, 300], [10.4, 276, E.cam], [19.6, 276], [20.6, 300, E.cam]])
  return { x: cx - OFF / s, y: cy, s }
}
const toScreen = (t: number, wx: number, wy: number): [number, number] => {
  const c = cam(t)
  return [W / 2 + (wx - c.x) * c.s, H / 2 + (wy - c.y) * c.s]
}

/* ── Precise edits: values over time ────────────────────────────────── */

const LIME_HSV: HSV = { h: 74.2, s: 0.795, v: 0.957 }
const padAt = (t: number) => Math.round(16 + 8 * ramp(t, A2.scrubA + 0.05, A2.scrubB, E.inOut))
const hsvAt = (t: number): HSV => {
  const p = ramp(t, A2.svA + 0.05, A2.svB, E.inOut)
  return { h: t >= A2.hue ? LIME_HSV.h : 0, s: mix(0, LIME_HSV.s, p), v: mix(1, LIME_HSV.v, p) }
}

/* ── Points the pointer goes to (stage coords) ──────────────────────── */

const INPUT: [number, number] = [70, 632]
const SEND_BTN: [number, number] = [CHAT_W - 41, 679]
// The chat header: "← Chats" at its left, the + (or the list's New) at its right.
const CHATS_BTN: [number, number] = [42, 21]
const PLUS_BTN: [number, number] = [CHAT_W - 20, 21]
const NEW_BTN: [number, number] = [CHAT_W - 32, 21]
const RAIL_X = CHAT_W + 35
const TOOL_PT = { inspect: [RAIL_X, 69] as [number, number], comment: [RAIL_X, 103] as [number, number] }
const CARD_PT = toScreen(A2.pickCard, 240, 207)
const PAD_LABEL: [number, number] = [PANEL_X + 100, 203]
const SWATCH: [number, number] = [PANEL_X + 31, 411]
const HUE: [number, number] = [PANEL_X + 30 + 216 * (LIME_HSV.h / 360), 586]
const SV0: [number, number] = [PANEL_X + 30, 432]
const SV1: [number, number] = [PANEL_X + 30 + 216 * LIME_HSV.s, 432 + 140 * (1 - LIME_HSV.v)]
// The Precise edits bar (centred on the canvas, x 700): its change count and Apply to code. Measured.
const BAR_COUNT: [number, number] = [660, 33]
const BAR_APPLY: [number, number] = [884, 33]
const SEND_COMMENTS: [number, number] = [PANEL_X + 140, 692]
const RESOLVED_TAB: [number, number] = [PANEL_X + 100, 63]
const pinPt = (c: C) => toScreen(c.click, FERN + c.at[0], c.at[1])
const POINTER_TOOL: [number, number] = [RAIL_X, 35]
const FERN_PICK = toScreen(A4.select, FERN + 150, 250)
// The See Code button in the selected frame's toolbar, a screen offset from its top-left corner. Measured.
const SEE_DX = 174
const SEE_DY = -19
const SEE_PT: [number, number] = [toScreen(A4.see, FERN, 0)[0] + SEE_DX, toScreen(A4.see, FERN, 0)[1] + SEE_DY]
const CLOSE_PT: [number, number] = [W - 26, 26]

const YOU: PathKey[] = [
  [0, 760, 520],
  [0.4, 760, 520],
  // Act 1: into the composer, aside while typing, send.
  [A1.click - 0.1, ...INPUT, E.inOut],
  [A1.click + 0.2, ...INPUT],
  [A1.click + 0.7, 228, 560],
  [A1.send - 0.5, 234, 566],
  [A1.send - 0.1, ...SEND_BTN, E.out],
  [A1.send + 0.2, ...SEND_BTN],
  [6.6, 860, 590, E.inOut],
  [TH.new1 - 0.9, 860, 590],
  // A new chat for the edits.
  [TH.new1 - 0.1, ...PLUS_BTN, E.inOut],
  [TH.new1 + 0.2, ...PLUS_BTN],
  // Act 2: Inspect, the card, padding, fill, the bar, Apply.
  [A2.tool - 0.1, ...TOOL_PT.inspect, E.inOut],
  [A2.tool + 0.2, ...TOOL_PT.inspect],
  [A2.hoverCard, ...CARD_PT, E.inOut],
  [A2.pickCard + 0.35, ...CARD_PT],
  [A2.scrubA - 0.12, ...PAD_LABEL, E.inOut],
  [A2.scrubA, ...PAD_LABEL],
  [A2.scrubB, PAD_LABEL[0] + 16, PAD_LABEL[1], E.inOut, true],
  [A2.scrubB + 0.2, PAD_LABEL[0] + 16, PAD_LABEL[1]],
  [A2.swatch - 0.1, ...SWATCH, E.inOut],
  [A2.swatch + 0.1, ...SWATCH],
  [A2.hue - 0.1, ...HUE, E.inOut],
  [A2.hue + 0.05, ...HUE],
  [A2.svA - 0.07, ...SV0, E.inOut],
  [A2.svA, ...SV0],
  [A2.svB, ...SV1, E.inOut, true],
  [A2.esc + 0.1, SV1[0] - 10, SV1[1] + 30],
  [A2.list - 0.1, ...BAR_COUNT, E.inOut],
  [A2.list + 0.35, ...BAR_COUNT],
  [A2.apply - 0.1, ...BAR_APPLY, E.inOut],
  [A2.apply + 0.2, ...BAR_APPLY],
  [17.9, 820, 300, E.inOut],
  [TH.list1 - 0.9, 820, 300],
  // The Chats list, then New.
  [TH.list1 - 0.1, ...CHATS_BTN, E.inOut],
  [TH.list1 + 0.2, ...CHATS_BTN],
  [TH.new2 - 0.1, ...NEW_BTN, E.inOut],
  [TH.new2 + 0.2, ...NEW_BTN],
  // Act 3: the Comment tool, two pins, send, Resolved.
  [A3.tool - 0.1, ...TOOL_PT.comment, E.inOut],
  [A3.tool + 0.2, ...TOOL_PT.comment],
  ...COMMENTS.flatMap((c): PathKey[] => [
    [c.click - 0.12, ...pinPt(c), E.inOut],
    [c.enter + 0.1, ...pinPt(c)],
  ]),
  [A3.send - 0.1, ...SEND_COMMENTS, E.inOut],
  [A3.send + 0.3, ...SEND_COMMENTS],
  [25.6, 900, 420, E.inOut],
  [A3.resolved - 0.9, 900, 420],
  [A3.resolved - 0.1, ...RESOLVED_TAB, E.inOut],
  [A3.resolved + 0.4, ...RESOLVED_TAB],
  // Act 4: the pointer tool, select the frame, See Code, read, close.
  [A4.pointer - 0.1, ...POINTER_TOOL, E.inOut],
  [A4.pointer + 0.2, ...POINTER_TOOL],
  [A4.select - 0.1, ...FERN_PICK, E.inOut],
  [A4.select + 0.2, ...FERN_PICK],
  [A4.see - 0.1, ...SEE_PT, E.inOut],
  [A4.see + 0.3, ...SEE_PT],
  [A4.see + 1.0, 700, 560, E.inOut],
  [A4.close - 0.8, 700, 560],
  [A4.close - 0.08, ...CLOSE_PT, E.inOut],
  [A4.close + 0.3, ...CLOSE_PT],
  [TH.list2 - 0.1, ...CHATS_BTN, E.inOut],
  [TH.list2 + 0.3, ...CHATS_BTN],
  [TH.list2 + 1.0, 200, 300, E.inOut],
  [DUR, 200, 300],
]
const CLICKS = [A1.click, A1.send, A2.tool, A2.pickCard, A2.swatch, A2.hue, A2.list, A2.apply, A3.tool, ...COMMENTS.map((c) => c.click), A3.send, A3.resolved, A4.pointer, A4.select, A4.see, A4.close, TH.new1, TH.list1, TH.new2, TH.list2]
const pressAt = (t: number) => {
  let p = Math.max(...CLICKS.map((c) => Math.sin(Math.PI * ramp(t, c - 0.08, c + 0.12, E.linear))))
  for (const [a, b] of [
    [A2.scrubA, A2.scrubB],
    [A2.svA, A2.svB],
  ])
    if (t >= a - 0.06 && t < b + 0.05) p = Math.max(p, ramp(t, a - 0.06, a, E.linear) * (1 - ramp(t, b, b + 0.05, E.linear)))
  return p
}
/** With Inspect or Comment on, the crosshair shows over a frame; elsewhere the arrow. */
const crosshairAt = (t: number) => {
  if (toolAt(t) === "pointer") return false
  const [x, y] = path(t, YOU)
  if (x < CHAT_W || x > PANEL_X) return false
  return FRAME_XS.some((fx) => {
    const [x0, y0] = toScreen(t, fx, 0)
    const [x1, y1] = toScreen(t, fx + 300, 600)
    return x > x0 && x < x1 && y > y0 && y < y1
  })
}

/* ── The Antidraw cursor (world coords), once per act ───────────────── */

const AGENT: { keys: PathKey[]; on: [number, number] }[] = [
  {
    on: [5.8, 8.6],
    keys: [
      [5.8, 700, 650],
      [6.4, 830, 200, E.out],
      [7.2, 1000, 420],
      [7.8, 1230, 180],
      [8.4, 1300, 420],
    ],
  },
  {
    on: [17.35, 19.2],
    keys: [
      [17.35, 300, 520],
      [17.9, 236, 214, E.out],
      [18.6, 250, 236],
      [19.1, 330, 330],
    ],
  },
  {
    on: [26.4, 29.5],
    keys: [
      [26.4, FERN + 380, 520],
      ...COMMENTS.flatMap((c): PathKey[] => [
        [c.edit, FERN + c.agent[0], c.agent[1], E.out],
        [c.done, FERN + c.agent[0] + 18, c.agent[1] + 10],
      ]),
      [29.4, FERN + 360, 470, E.inOut],
    ],
  },
]

function AgentCursor({ keys, on }: { keys: PathKey[]; on: [number, number] }) {
  const opacity = useTrack((t) => kf(t, [[on[0], 0], [on[0] + 0.25, 1], [on[1] - 0.3, 1], [on[1], 0]]))
  return <WorldCursor keys={keys} claude label="Antidraw" opacity={opacity} />
}

/* ── Overlay: pointer, pins, comment box, key hints ─────────────────── */

function Overlay() {
  const x = useTrack((t) => path(t, YOU)[0])
  const y = useTrack((t) => path(t, YOU)[1])
  const vis = (t: number) => ramp(t, 0.2, 0.5) * (1 - ramp(t, TH.list2 + 1.2, TH.list2 + 1.6))
  const crossOp = useTrack((t) => (crosshairAt(t) ? 1 : 0) * vis(t))
  const arrowOp = useTrack((t) => (crosshairAt(t) ? 0 : 1) * vis(t))
  const press = useTrack((t) => 1 - 0.16 * pressAt(t))
  const kx = useTrack((t) => path(t, YOU)[0] + 16)
  const ky = useTrack((t) => path(t, YOU)[1] + 14)
  const escOp = useTrack((t) => ramp(t, A2.esc - 0.1, A2.esc) * (1 - ramp(t, A2.esc + 0.45, A2.esc + 0.65)))
  const enterOp = useTrack((t) => Math.max(...COMMENTS.map((c) => ramp(t, c.enter - 0.1, c.enter) * (1 - ramp(t, c.enter + 0.25, c.enter + 0.4)))))
  return (
    <>
      <Pins />
      <Box />
      <CodeViewer />
      {AGENT.map((a, i) => (
        <AgentCursor key={i} {...a} />
      ))}
      <Crosshair x={x} y={y} opacity={crossOp} press={press} />
      <Cursor x={x} y={y} opacity={arrowOp} press={press} />
      <KeyHint x={kx} y={ky} label="Esc" opacity={escOp} />
      <KeyHint x={kx} y={ky} label="Enter ↵" opacity={enterOp} />
    </>
  )
}

/** Antidraw's read-only code viewer, sliding in from the right over the panel. */
function CodeViewer() {
  const on = useAt((t) => t >= A4.see && t < A4.close + 0.45)
  const x = useTrack((t) => CODE_W * (1 - ramp(t, A4.see + 0.05, A4.see + 0.4, E.out)) + CODE_W * ramp(t, A4.close + 0.05, A4.close + 0.38, E.inOut))
  const scroll = useTrack((t) => -20 * 16 * ramp(t, A4.see + 1.0, A4.see + 2.2) - 20 * 14 * ramp(t, A4.see + 2.6, A4.see + 3.6))
  const closePress = useAt((t) => Math.round(Math.sin(Math.PI * ramp(t, A4.close - 0.08, A4.close + 0.12, E.linear)) * 10) / 10)
  if (!on) return null
  return <CodePanel x={x} fileName="FernhollowStay.tsx" code={FERN_CODE} scroll={scroll} closePress={closePress} />
}

/** Draft pins once entered, grey once sent, gone once the agent marks them. */
function Pins() {
  const key = useAt((t) => COMMENTS.map((c) => (t < c.enter || t >= c.mark ? "-" : t < A3.send ? "draft" : "sent")).join("|"))
  const states = key.split("|")
  return (
    <>
      {COMMENTS.map((c, i) => {
        if (states[i] === "-") return null
        const [px, py] = pinPt(c)
        return <Pin key={i} x={px} y={py} n={i + 1} state={states[i] as "draft" | "sent"} />
      })}
    </>
  )
}

/** pieces.tsx `beside`: right of the pin, or left when it would run off the canvas. */
const beside = (x: number, y: number) => {
  const cx = x - CHAT_W
  return { left: CHAT_W + (cx + 26 + BOX > CANVAS_W - 8 ? cx - BOX - 8 : cx + 26), top: y - 34 }
}

function Box() {
  const open = useAt((t) => COMMENTS.findIndex((c) => t >= c.click && t < c.enter))
  const n = useAt((t) => {
    const c = COMMENTS.find((c) => t >= c.click && t < c.enter)
    return c ? typed(t, c.a, c.b, c.text) : 0
  })
  if (open < 0) return null
  const c = COMMENTS[open]
  const [x, y] = pinPt(c)
  const { left, top } = beside(x, y)
  return <CommentBox x={x} y={y} left={left} top={top} text={c.text.slice(0, n)} caret />
}

/* ── Frames ─────────────────────────────────────────────────────────── */

function SproutFrame() {
  const pad = useAt(padAt)
  const fill = useAt((t) => hsvToHex(hsvAt(t)))
  const sel = useTrack((t) => cardRect(padAt(t), 18))
  const hover = useTrack((t) => ramp(t, A2.hoverCard - 0.05, A2.hoverCard + 0.05) * (1 - ramp(t, A2.pickCard, A2.pickCard + 0.08)))
  const pickOp = useTrack((t): number => (t >= A2.pickCard && t < A3.tool ? 1 : 0))
  return (
    <Frame name="SproutHome" x={SPROUT} y={0} w={300} h={600}>
      <SproutHome pad={pad} fill={fill} size={18} />
      <HoverBoxes rect={cardRect(16, 18)} pad={16} opacity={hover} />
      <PickOutline rect={sel} opacity={pickOp} />
    </Frame>
  )
}

function FernFrame() {
  const bold = useAt((t) => Math.round(ramp(t, COMMENTS[0].done, COMMENTS[0].done + 0.5, E.out) * 100) / 100)
  const green = useAt((t) => Math.round(ramp(t, COMMENTS[1].done, COMMENTS[1].done + 0.45) * 100) / 100)
  const selected = useAt((t) => t >= A4.select && t < A4.close + 0.3)
  return (
    <Frame name="FernhollowStay" x={FERN} y={0} w={300} h={600} selected={selected}>
      <FernhollowStay bold={bold} green={green} />
    </Frame>
  )
}

/** A variation: shimmers in as its row starts, its content fades up as the row finishes. */
function Variation({ name, x, lake, night, row }: (typeof VARS)[number]) {
  const at = row[0] + 0.2
  const ready = row[1] - 0.3
  const scale = useTrack((t) => kf(t, [[at, 0.92], [at + 0.5, 1, E.pop]]))
  const opacity = useTrack((t) => kf(t, [[at, 0], [at + 0.2, 1]]))
  const skel = useTrack((t) => kf(t, [[ready, 1], [ready + 0.35, 0]]))
  const content = useTrack((t) => kf(t, [[ready, 0], [ready + 0.3, 1]]))
  const shown = useAt((t) => t >= at)
  const live = useAt((t) => t > ready - 0.05)
  if (!shown) return null
  return (
    <Frame name={name} x={x} y={0} w={300} h={600} opacity={opacity} scale={scale}>
      <motion.div className="absolute inset-0" style={{ opacity: content }}>
        {live && <FernhollowStay lake={lake} night={night} />}
      </motion.div>
      <motion.div className="absolute inset-0" style={{ opacity: skel }}>
        <Skeleton />
      </motion.div>
    </Frame>
  )
}

/* ── Right panel: Design (the picked card), then Comments ───────────── */

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

function CardSections({ pad, fill, scrub, pickerOpen }: { pad: number; fill: string; scrub: boolean; pickerOpen: boolean }) {
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
            <Sides h={pad} v={pad} scrub={scrub} />
          </div>
        </div>
        <div className="flex min-h-8 items-center gap-2">
          <span className="w-[72px] shrink-0 truncate text-[12px]" style={{ color: K.text2 }}>
            Margin
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Sides h={0} v={0} />
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
        <ColorRow hex={fill} open={pickerOpen} right={<RemoveBtn />} />
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
      <div className="border-t border-[#333]" />
    </Sections>
  )
}

function DesignPanel() {
  const picked = useAt((t) => t >= A2.pickCard)
  const pad = useAt(padAt)
  const hsvKey = useAt((t) => JSON.stringify(hsvAt(t)))
  const hsv = JSON.parse(hsvKey) as HSV
  const fill = hsvToHex(hsv)
  const scrub = useAt((t) => t >= A2.scrubA - 0.05 && t < A2.scrubB + 0.1)
  const picker = useAt((t) => t >= A2.swatch && t < A2.esc)
  return (
    <>
      <RightPanelShell edited={picked && (pad !== 16 || fill !== "#FFFFFF")}>
        {picked ? <CardSections pad={pad} fill={fill} scrub={scrub} pickerOpen={picker} /> : <SelectEmpty />}
      </RightPanelShell>
      {picker && (
        <motion.div className="absolute z-50" style={{ left: SWATCH[0] - 9 - PANEL_X, top: 424 }} initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.14, ease: "easeOut" }}>
          <Picker hsv={hsv} width={216} />
        </motion.div>
      )}
    </>
  )
}

function CommentsPanel() {
  const drafts = useAt((t) => (t >= A3.send ? 0 : COMMENTS.filter((c) => t >= c.enter).length))
  const sent = useAt((t) => t >= A3.send)
  const marked = useAt((t) => COMMENTS.filter((c) => t >= c.mark).length)
  const view = useAt((t) => (t >= A3.resolved ? "resolved" : "open"))
  const press = useAt((t) => Math.round(Math.sin(Math.PI * ramp(t, A3.send - 0.08, A3.send + 0.12, E.linear)) * 10) / 10)
  const resolved = COMMENTS.map((c, i) => ({ c, i })).filter(({ i }) => i < marked).reverse()
  const open = COMMENTS.map((c, i) => ({ c, i })).filter(({ i }) => i >= marked)
  return (
    <RightPanelShell
      tab="comments"
      drafts={drafts}
      foot={
        drafts > 0 ? (
          <NotSentFoot count={drafts} press={press}>
            {COMMENTS.slice(0, drafts).map((c, i) => (
              <div key={i} className="uat-card-in">
                <OutboxCard kind="draft" n={i + 1} text={c.text} frame="FernhollowStay" element={c.element} />
              </div>
            ))}
          </NotSentFoot>
        ) : sent ? (
          <p className="m-0 shrink-0 border-t border-white/[0.05] px-3.5 py-3 text-[12px] text-white/35">Click a frame to leave a comment.</p>
        ) : null
      }
    >
      {sent ? (
        <div className="flex flex-col px-1.5 pt-1.5">
          <OutboxFilter value={view} open={open.length} resolved={resolved.length} />
          {view === "open" ? (
            open.length ? (
              <div className="flex flex-col gap-0.5 pt-1">
                {open.map(({ c, i }) => (
                  <OutboxCard key={i} kind="working" text={c.text} frame="FernhollowStay" element={c.element} chat={1} />
                ))}
              </div>
            ) : (
              <p className="m-0 px-3 py-6 text-center text-[12.5px] leading-[18px] text-white/35">Nothing with the agent right now.</p>
            )
          ) : (
            <div className="flex flex-col gap-0.5 pt-1">
              {resolved.map(({ c, i }) => (
                <div key={i} className="uat-card-in">
                  <OutboxCard kind="done" text={c.text} frame="FernhollowStay" element={c.element} chat={1} note={c.note} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </RightPanelShell>
  )
}

function Panel() {
  const comments = useAt((t) => t >= A3.tool)
  return (
    <div className="absolute inset-y-0 right-0 z-40" style={{ width: PANEL_W }}>
      {comments ? <CommentsPanel /> : <DesignPanel />}
      <style>{`@keyframes uat-card-in { from { opacity: 0; transform: translateY(6px) } } .uat-card-in { animation: uat-card-in .3s cubic-bezier(.22,1,.36,1) both } @media (prefers-reduced-motion: reduce) { .uat-card-in { animation: none } }`}</style>
    </div>
  )
}

/** The Precise edits bar, from the first pick until the agent has applied them. */
function Bar() {
  const on = useAt((t) => t >= A2.pickCard && t < A2.editDone + 0.4)
  const pad = useAt(padAt)
  const fill = useAt((t) => hsvToHex(hsvAt(t)))
  const applied = useAt((t) => t >= A2.apply)
  const applying = useAt((t) => t >= A2.apply && t < A2.editDone)
  const open = useAt((t) => t >= A2.list && t < A2.apply)
  const press = useAt((t) => Math.round(Math.sin(Math.PI * ramp(t, A2.apply - 0.08, A2.apply + 0.12, E.linear)) * 10) / 10)
  if (!on) return null
  const changes = applied
    ? []
    : [...(pad !== 16 ? [{ label: "Padding", from: "16", to: String(pad) }] : []), ...(fill !== "#FFFFFF" ? [{ label: "Fill", from: "#FFFFFF", to: fill }] : [])]
  const els: BarElement[] = changes.length ? [{ name: "div.absolute.flex.flex-col.rounded-[18px]", changes }] : []
  return <EditBar elements={els} open={open} applying={applying ? { n: 2, els: 1 } : null} press={press} className="!left-[700px]" />
}

/* ── Chat ───────────────────────────────────────────────────────────── */

const DIFF: DiffLine[] = [
  { n: 38, kind: "-", code: '<div className="rounded-[18px] bg-white p-4">' },
  { n: 38, kind: "+", code: '<div className="rounded-[18px] bg-[#c6f432] p-6">' },
  { n: 39, kind: " ", code: '  <h3 className="text-[18px] font-semibold">' },
]
const COMPLETE = "mcp__canvas_comments__complete_comment"

/** The chat side panel's thread view (SidePanel.tsx ConversationView): "← Chats / title", a + for a new chat, the messages, the composer. */
function Thread({ title, children, composer }: { title: string; children: ReactNode; composer: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-[#333] bg-[#2A2A2A] font-sans">
      <div className="flex items-center gap-1 border-b border-[#333] p-2">
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-[13px] font-medium">
          <span className="flex h-6 shrink-0 items-center gap-1 rounded-md pr-2 pl-1.5 text-neutral-500">
            <ArrowLeft className="size-4" />
            Chats
          </span>
          <span className="shrink-0 text-neutral-600">/</span>
          <span className="truncate pl-2 text-neutral-400">{title}</span>
        </nav>
        <span className="rounded-md p-1 text-[#71717a]">
          <Plus className="size-4" />
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
        <div className="flex flex-col p-4 pt-2">{children}</div>
      </div>
      {composer}
    </div>
  )
}

type Conv = { title: string; when: string; summary: string }
const OLDER: Conv[] = [
  { title: "Museum map ideas", when: "1h", summary: "Three floor-map styles for MuseumMap" },
  { title: "Onboarding flow", when: "Yesterday", summary: "A five-step onboarding you can click through" },
]
const CONV = {
  fern: { title: "Fernhollow comments", when: "now", summary: "Bolder title, a green Book 2 nights button" },
  sprout: { title: "Sprout card polish", when: "2m", summary: "Padding and fill written into SproutHome.tsx" },
  concepts: { title: "Three screens, two takes", when: "12m", summary: "MuseumHome, SproutHome, FernhollowStay, and two takes on it" },
}

/** The Chats list (SidePanel.tsx ConversationList): header with New, search, the threads. */
function ChatList({ convs, pressNew }: { convs: Conv[]; pressNew?: boolean }) {
  return (
    <div className="flex h-full flex-col overflow-hidden border-r border-[#333] bg-[#2A2A2A] font-sans">
      <div className="flex items-center justify-between border-b border-[#333] p-2">
        <span className="px-2.5 py-0.5 text-[13px] font-medium text-neutral-400">Chats</span>
        <span className={cn("flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[12px] text-neutral-500 transition-colors", pressNew && "bg-white/[0.06] text-neutral-200")}>
          <Plus className="size-3" />
          New
        </span>
      </div>
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-3">
        <Search className="size-3.5 shrink-0 text-neutral-600" />
        <span className="text-[13px] text-neutral-600">Search...</span>
      </div>
      <div className="flex flex-col px-2 pb-2">
        {convs.map((c, i) => (
          <div key={c.title} className={cn("mb-0.5 flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 uat-card-in", i === 0 && "bg-white/[0.04]")}>
            <div className="flex w-full items-center justify-between gap-2">
              <span className={cn("flex-1 truncate text-[13px] font-medium", i === 0 ? "text-neutral-200" : "text-neutral-400")}>{c.title}</span>
              <span className="shrink-0 text-[10px] text-neutral-600">{c.when}</span>
            </div>
            <span className="w-full truncate text-[11px] text-[#71717a]">{c.summary}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** A brand-new thread, before its first message (ChatEmptyState.tsx). */
const EmptyThread = () => (
  <div className="flex flex-col items-start pb-2">
    <span className="text-sm font-medium tracking-[-0.02em] text-[#b0b0b0]">Chat to create designs.</span>
    <p className="m-0 mt-1.5 max-w-[280px] text-xs leading-normal text-[#787878]">Describe a component, screen, or interaction. Ask for multiple versions to see different directions.</p>
  </div>
)

/** Which view the chat panel shows at t. */
const chatView = (t: number) => (t >= TH.list2 ? "list2" : t >= TH.new2 ? "fern" : t >= TH.list1 ? "list1" : t >= TH.new1 ? "sprout" : "concepts")

function Chat() {
  const view = useAt(chatView)
  const pressNew = useAt((t) => t > TH.new2 - 0.12 && t < TH.new2 + 0.1)
  return (
    <div className="absolute inset-y-0 left-0 z-40" style={{ width: CHAT_W }}>
      {view === "concepts" ? (
        <ConceptsThread />
      ) : view === "sprout" ? (
        <SproutThread />
      ) : view === "list1" ? (
        <ChatList convs={[CONV.sprout, CONV.concepts, ...OLDER]} pressNew={pressNew} />
      ) : view === "fern" ? (
        <FernThread />
      ) : (
        <ChatList convs={[CONV.fern, CONV.sprout, CONV.concepts, ...OLDER]} />
      )}
    </div>
  )
}

const idle = <Composer text="" effort={false} />

/** Thread 1: the three screens, then the variations. */
function ConceptsThread() {
  const n = useAt((t) => (t < A1.send ? typed(t, A1.type[0], A1.type[1], PROMPT) : 0))
  const caret = useAt((t) => t > A1.click + 0.05 && t < A1.send)
  const press = useAt((t) => Math.round(Math.sin(Math.PI * ramp(t, A1.send - 0.15, A1.send + 0.05, E.linear)) * 10) / 10)
  const ask = useAt((t) => t >= A1.send)
  const varRows = useAt((t) => VARS.map((v) => (t < v.row[0] ? "-" : t < v.row[1] ? "run" : "done")).join("|")).split("|")
  const reply = useAt((t) => t >= A1.reply)
  const working = useAt((t) => t >= A1.send + 0.15 && t < VARS[0].row[0])
  return (
    <Thread title={CONV.concepts.title} composer={<Composer text={PROMPT.slice(0, n)} caret={caret} ready={n > 0} press={press} effort={false} />}>
      <Reveal on>
        <UserBubble>Design three screens: a museum home, a savings home for Sprout, and the Fernhollow cabin booking.</UserBubble>
      </Reveal>
      <Reveal on>
        <ToolGroup>
          <ToolRow title="Crafting MuseumHome" />
          <ToolRow title="Crafting SproutHome" />
          <ToolRow title="Crafting FernhollowStay" />
        </ToolGroup>
      </Reveal>
      <Reveal on>
        <AssistantText>All three are on the canvas, side by side.</AssistantText>
      </Reveal>
      <Reveal on={ask}>
        <UserBubble>{PROMPT}</UserBubble>
      </Reveal>
      <Reveal on={varRows[0] !== "-"}>
        <ToolGroup>
          {VARS.map((v, i) => (varRows[i] === "-" ? null : <ToolRow key={v.name} title={`Crafting ${v.name}`} running={varRows[i] === "run"} />))}
        </ToolGroup>
      </Reveal>
      <Reveal on={reply}>
        <AssistantText>Two more takes beside it: FernhollowLake with the lake photo, and FernhollowNight in dark.</AssistantText>
      </Reveal>
      {working && <Working />}
    </Thread>
  )
}

/** Thread 2, new: the precise edits arrive and the agent writes them. */
function SproutThread() {
  const edits = useAt((t) => t >= A2.apply + 0.1)
  const edit = useAt((t) => t >= A2.edit)
  const editDone = useAt((t) => t >= A2.editDone)
  const plus = useAt((t) => Math.floor(ramp(t, A2.edit + 0.25, A2.edit + 0.8, E.linear) * 1.999))
  const final = useAt((t) => t >= A2.final)
  const working = useAt((t) => t >= A2.apply + 0.25 && t < A2.edit)
  return (
    <Thread title={final ? CONV.sprout.title : "Untitled Conversation"} composer={idle}>
      {!edits && <EmptyThread />}
      <Reveal on={edits}>
        <UserBubble tags={[{ frame: "SproutHome" }]}>{"Padding: 16 → 24\nFill: #FFFFFF → #C6F432"}</UserBubble>
      </Reveal>
      <Reveal on={edit}>
        <ToolGroup>
          <ToolRow title="Refining SproutHome" running={!editDone} open>
            <Field name="file_path" value="src/components/user-components/SproutHome.tsx" />
            <DiffLines lines={DIFF} shown={plus} />
          </ToolRow>
        </ToolGroup>
      </Reveal>
      <Reveal on={final}>
        <AssistantText>
          Wrote both into <code>SproutHome.tsx</code>: <code>p-6</code> and <code>bg-[#c6f432]</code> on the card.
        </AssistantText>
      </Reveal>
      {working && <Working />}
    </Thread>
  )
}

/** Thread 3, new: the comments arrive together and the agent works down them. */
function FernThread() {
  const sent = useAt((t) => t >= A3.send + 0.1)
  const intro = useAt((t) => t >= A3.intro)
  const rows = COMMENTS.flatMap((c) => [
    { title: "Refining FernhollowStay", start: c.edit, done: c.done },
    { title: COMPLETE, start: c.done + 0.12, done: c.mark },
  ])
  const shown = useAt((t) => rows.filter((r) => t >= r.start).length)
  const finished = useAt((t) => rows.filter((r) => t >= r.done).length)
  const final = useAt((t) => t >= A3.final)
  const working = useAt((t) => t >= A3.send + 0.25 && t < A3.intro)
  return (
    <Thread title={final ? CONV.fern.title : "Untitled Conversation"} composer={idle}>
      {!sent && <EmptyThread />}
      <Reveal on={sent}>
        <UserBubble tags={[{ frame: "FernhollowStay" }]}>{COMMENTS.map((c) => c.text).join("\n\n")}</UserBubble>
      </Reveal>
      <Reveal on={intro}>
        <AssistantText>Two comments on FernhollowStay. Working through them in order.</AssistantText>
      </Reveal>
      <Reveal on={shown > 0}>
        <ToolGroup>
          {rows.slice(0, Math.max(1, shown)).map((r, i) => (
            <ToolRow key={i} title={r.title} running={i >= finished} />
          ))}
        </ToolGroup>
      </Reveal>
      <Reveal on={final}>
        <AssistantText>Both done and marked: a bolder title, and a green Book 2 nights button.</AssistantText>
      </Reveal>
      {working && <Working />}
    </Thread>
  )
}

/* ── Scene ──────────────────────────────────────────────────────────── */

function Tools() {
  const mode = useAt(toolAt)
  return <CanvasTools mode={mode} className="!left-[415px]" />
}

/** The whole scene fades in at the start and out through the loop seam. */
function Fade({ children }: { children: ReactNode }) {
  const opacity = useTrack((t) => (t < 1 ? kf(t, [[0, 0], [0.4, 1]]) : kf(t, [[DUR - 0.6, 1], [DUR, 0]])))
  return (
    <motion.div className="absolute inset-0" style={{ opacity }}>
      {children}
    </motion.div>
  )
}

export function UseCaseAntidrawTourScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={cn("rounded-[12px]", className)}>
      <MotionSeek />
      <Fade>
        <div className="absolute inset-0 overflow-hidden rounded-[12px] border border-white/[0.06] bg-[#282828] font-sans">
          <Camera cam={cam} overlay={<Overlay />}>
            <Frame name="MuseumHome" x={MUSEUM} y={0} w={300} h={600}>
              <MuseumHome />
            </Frame>
            <SproutFrame />
            <FernFrame />
            {VARS.map((v) => (
              <Variation key={v.name} {...v} />
            ))}
          </Camera>
          <Tools />
          <Bar />
          <Chat />
          <Panel />
        </div>
      </Fade>
    </Scene>
  )
}

export default function UseCaseAntidrawTour() {
  return (
    <ScenePage label="Antidraw · the whole app: variations, precise edits, comments, code">
      <UseCaseAntidrawTourScene className="shadow-[0_30px_80px_rgba(0,0,0,0.45)]" />
    </ScenePage>
  )
}
