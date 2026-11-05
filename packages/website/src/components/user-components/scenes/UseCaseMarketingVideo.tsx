/**
 * Marketers · "Launch videos with Remotion": feature announcements made from
 * the team's real components and brand, scene by scene.
 *
 * Same language as UseCasePMRealData, on a transparent stage:
 *   0–1.9s    Fernway's TrailMap, TrailCard and SaveOffline sit on the
 *             canvas. The marketer clicks them one by one; each lands in
 *             the composer as a chip.
 *   2.0–3.9s  "A 15-second launch video for Offline maps, using these."
 *   4.0–6.2s  The agent reads the three components and writes LaunchVideo,
 *             a Remotion composition, shown as a player frame: a 16:9
 *             preview, a control bar, and a timeline of four scene blocks
 *             (Hook / Feature / Product UI / CTA), each naming what it uses.
 *   6.0–11.2s The preview plays: the map under the hook "Out of signal.
 *             Still on the map.", then the cream Feature scene, where the
 *             same TrailCard and SaveOffline rise in. The reply lands.
 *   7.6–10.6s The marketer asks for a new hook; the agent edits the Hook
 *             scene (its block flashes and keeps a dot) and says so.
 *  11.2–14.6s The marketer grabs the playhead and scrubs, the preview
 *             following frame by frame: back to the new hook, forward to the
 *             two cards, then on through the zoom on Save offline (tapped,
 *             it fills). They let go at "Ready offline" and it plays on into
 *             the end card.
 *  15.8s–     Held on the end card, then a fade through the loop seam.
 *
 * Pieces: usecase/design/chat.tsx. Components, composition and player:
 * usecase/marketing/offline-launch.tsx.
 */
import type { ReactNode } from "react"
import { ArrowUp } from "lucide-react"
import { motion } from "motion/react"

import { cn } from "@/lib/utils"
import { BLUE, Cursor, E, Scene, ScenePage, Skeleton, kf, path, ramp, typed, useAt, useTrack, type Key, type PathKey } from "../motion/canvas-ai/kit"
import { AssistantText, Chip, Reveal, ToolGroup, ToolRow, UserBubble } from "../usecase/design/chat"
import { C_H, C_W, HEAD_AT, HOOKS, PLAYER_H, PLAYER_W, Player, SaveOffline, TrailCard, TrailMap } from "../usecase/marketing/offline-launch"
import { MotionSeek } from "../usecase/ecosystem/seek"

const W = 1280
const H = 720
const DUR = 18
const STILL = 16.8

/* ── Timeline ─────────────────────────────────────────────────────────── */

const COMPONENTS = ["TrailMap", "TrailCard", "SaveOffline"] as const
const PICK = [0.7, 1.2, 1.7]

const PROMPT = "A 15-second launch video for Offline maps, using these."
const T = { type: [2.05, 3.5] as const, send: 3.85, reply: 6.4 }
const ROWS = [
  { title: "Read 3 components", start: 4.05, done: 4.6 },
  { title: "Writing LaunchVideo.tsx", start: 4.6, done: 5.7 },
  { title: "Checking all 450 frames", start: 5.7, done: 6.2 },
]
const SKEL = [4.6, 4.9] as const
const FILL = [5.6, 6.0] as const

const PROMPT2 = `Make the hook “${HOOKS[1].join(" ")}”`
const T2 = { type: [7.6, 9.05] as const, send: 9.4, reply: 10.6 }
const ROWS2 = [{ title: "Editing the Hook scene", start: 9.6, done: 10.4 }]
const EDIT = 10.2
const FLASH = [10.2, 10.35, 11.1] as const

// The playhead: plays from FILL; the marketer grabs it, scrubs back to the
// hook, then forward through the Feature and the zoom, and lets go: it plays on.
const PLAY = FILL[1]
const GRAB = 11.2
const RELEASE = 14.6
const SCRUB: Key[] = [
  [GRAB, GRAB - PLAY],
  [11.8, 1.8, E.inOut],
  [12.45, 1.8],
  [12.95, 5.4, E.inOut],
  [13.05, 5.4],
  [13.5, 7.1, E.in],
  [14.3, 9.2, E.linear],
  [RELEASE, 9.85, E.out],
]
const video = (t: number) => (t < PLAY ? 0 : t < GRAB ? t - PLAY : t < RELEASE ? kf(t, SCRUB) : 9.85 + (t - RELEASE))

/* ── Layout ───────────────────────────────────────────────────────────── */

const CHAT = { x: 72, y: 96, w: 300, h: 570 }
const SEND_AT: [number, number] = [CHAT.x + CHAT.w - 32, CHAT.y + CHAT.h - 32]
const INPUT_AT: [number, number] = [CHAT.x + 130, CHAT.y + CHAT.h - 52]

const CS = 0.8
const COL = { x: 968, gap: 22, label: 22 }
const CW = C_W * CS
const CH = C_H * CS
const COL_Y0 = Math.round(381 - (3 * (CH + COL.label) + 2 * COL.gap) / 2) + COL.label
const compAt = (i: number) => ({ x: COL.x, y: COL_Y0 + i * (CH + COL.label + COL.gap) })
const compPt = (i: number, fx = 0.5, fy = 0.5): [number, number] => [compAt(i).x + CW * fx, compAt(i).y + CH * fy]

// The player's top lines up with the column's.
const PLAYER = { x: 412, y: COL_Y0 }
const headPt = (v: number): [number, number] => [PLAYER.x + HEAD_AT(v)[0], PLAYER.y + HEAD_AT(v)[1]]

/* ── The pointer ──────────────────────────────────────────────────────── */

const YOU: PathKey[] = [
  [0, 1120, 690],
  [PICK[0] - 0.45, 1120, 690],
  [PICK[0] - 0.05, ...compPt(0, 0.55, 0.55), E.inOut],
  [PICK[0] + 0.12, ...compPt(0, 0.55, 0.55)],
  [PICK[1] - 0.05, ...compPt(1, 0.5, 0.45), E.inOut],
  [PICK[1] + 0.12, ...compPt(1, 0.5, 0.45)],
  [PICK[2] - 0.05, ...compPt(2, 0.45, 0.4), E.inOut],
  [PICK[2] + 0.12, ...compPt(2, 0.45, 0.4)],
  [T.type[0] - 0.05, ...INPUT_AT, E.inOut],
  [T.send - 0.45, ...INPUT_AT],
  [T.send - 0.08, ...SEND_AT, E.inOut],
  [T.send + 0.3, ...SEND_AT],
  [5.2, 690, 650, E.inOut],
  [T2.type[0] - 0.55, 690, 650],
  [T2.type[0] - 0.05, ...INPUT_AT, E.inOut],
  [T2.send - 0.45, ...INPUT_AT],
  [T2.send - 0.08, ...SEND_AT, E.inOut],
  [T2.send + 0.35, ...SEND_AT],
  [10.45, ...SEND_AT],
  [GRAB - 0.05, ...headPt(video(GRAB - 0.05)), E.inOut],
]
const AFTER: PathKey[] = [
  [RELEASE + 0.1, ...headPt(video(RELEASE))],
  [15.4, headPt(video(RELEASE))[0] + 30, headPt(video(RELEASE))[1] + 64, E.inOut],
]
/** The pointer: its path, except while it holds the playhead, when it rides the handle exactly. */
const you = (t: number): [number, number] => (t < GRAB - 0.05 ? path(t, YOU) : t < RELEASE + 0.1 ? headPt(video(Math.min(t, RELEASE))) : path(t, AFTER))
const CLICKS = [...PICK, T.send, T2.send]

/* ── Pieces ───────────────────────────────────────────────────────────── */

function Chat() {
  const opacity = useTrack((t) => ramp(t, 0.2, 0.6))
  const which = useAt((t) => (t < T.send ? 1 : t < T2.send ? 2 : 0))
  const n = useAt((t) => (t < T.send ? typed(t, T.type[0], T.type[1], PROMPT) : typed(t, T2.type[0], T2.type[1], PROMPT2)))
  const press = useAt((t) => Math.round(Math.max(...[T.send, T2.send].map((s) => Math.sin(Math.PI * ramp(t, s - 0.08, s + 0.12, E.linear)))) * 10) / 10)
  const sent = useAt((t) => t >= T.send + 0.1)
  const sent2 = useAt((t) => t >= T2.send + 0.1)
  const chips = useAt((t) => (t < T.send ? PICK.filter((p) => t >= p + 0.05).length : 0))
  const shown = useAt((t) => ROWS.filter((r) => t >= r.start).length)
  const finished = useAt((t) => ROWS.filter((r) => t >= r.done).length)
  const shown2 = useAt((t) => ROWS2.filter((r) => t >= r.start).length)
  const finished2 = useAt((t) => ROWS2.filter((r) => t >= r.done).length)
  const reply = useAt((t) => t >= T.reply)
  const reply2 = useAt((t) => t >= T2.reply)
  const text = which === 1 ? PROMPT : which === 2 ? PROMPT2 : ""
  const typing = which !== 0 && n > 0
  return (
    <motion.div
      className="absolute flex flex-col overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#2A2A2A] font-sans shadow-[0_10px_28px_-12px_rgba(0,0,0,0.32)]"
      style={{ left: CHAT.x, top: CHAT.y, width: CHAT.w, height: CHAT.h, opacity }}
    >
      <div className="flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-3 pb-1">
        <Reveal on={sent}>
          <UserBubble className="[&>div]:max-w-[92%]" tags={COMPONENTS.map((frame) => ({ frame }))}>
            {PROMPT}
          </UserBubble>
        </Reveal>
        <Reveal on={shown > 0}>
          <ToolGroup>
            {ROWS.slice(0, Math.max(1, shown)).map((r, i) => (
              <ToolRow key={i} title={r.title} running={i >= finished} />
            ))}
          </ToolGroup>
        </Reveal>
        <Reveal on={reply}>
          <AssistantText>LaunchVideo is a 15-second Remotion composition in four scenes, made from your three components in Fernway's type and colours. Scrub the timeline to check any frame.</AssistantText>
        </Reveal>
        <Reveal on={sent2}>
          <UserBubble className="[&>div]:max-w-[92%]">{PROMPT2}</UserBubble>
        </Reveal>
        <Reveal on={shown2 > 0}>
          <ToolGroup>
            {ROWS2.map((r, i) => (
              <ToolRow key={i} title={r.title} running={i >= finished2} />
            ))}
          </ToolGroup>
        </Reveal>
        <Reveal on={reply2}>
          <AssistantText>The Hook scene has the new line. Drag back to the start to see it.</AssistantText>
        </Reveal>
      </div>
      <div className="relative m-2.5 mt-1.5 min-h-[86px] shrink-0 border border-neutral-600 bg-neutral-700 p-2.5 pb-11 shadow-xs">
        {chips > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {COMPONENTS.slice(0, chips).map((c) => (
              <Chip key={c} frame={c} className="mv-pop" />
            ))}
          </div>
        )}
        <div className="pr-9 text-[13px] leading-[1.45] text-neutral-50">
          {typing ? text.slice(0, n) : <span className="text-neutral-400">Ask me anything...</span>}
          {typing && <span className="mv-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
        </div>
        <span className={cn("absolute right-2 bottom-2 grid size-7 place-items-center rounded-full bg-neutral-50 text-neutral-900", !typing && "opacity-50")} style={{ transform: `scale(${1 - press * 0.12})` }}>
          <ArrowUp className="size-3.5" />
        </span>
      </div>
    </motion.div>
  )
}

/** One product component on the canvas: its name above, the selection ring while it's picked. */
function Component({ i, children }: { i: number; children: ReactNode }) {
  const opacity = useTrack((t) => ramp(t, 0.1, 0.4))
  const selected = useAt((t) => t >= PICK[i] && t < T.send)
  const { x, y } = compAt(i)
  return (
    <motion.div className="absolute font-sans" style={{ left: x, top: y - COL.label, width: CW, opacity }}>
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">{COMPONENTS[i]}</div>
      <div className="relative rounded-[11px] shadow-[0_10px_28px_-14px_rgba(0,0,0,0.35)]" style={{ width: CW, height: CH }}>
        <div className="absolute top-0 left-0 origin-top-left" style={{ width: C_W, height: C_H, transform: `scale(${CS})` }}>
          {children}
        </div>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-[11px] transition-opacity duration-200" style={{ top: COL.label, boxShadow: `0 0 0 1.5px ${BLUE}`, opacity: selected ? 1 : 0 }} />
    </motion.div>
  )
}

function LaunchVideoFrame() {
  const opacity = useTrack((t) => ramp(t, SKEL[0], SKEL[1]))
  const built = useAt((t) => t >= FILL[0])
  const clipPath = useTrack((t) => `inset(0 0 ${(1 - ramp(t, FILL[0], FILL[1], E.inOut)) * 100}% 0)`)
  const v = useAt((t) => Math.round(video(t) * 30) / 30)
  const playing = useAt((t) => t >= PLAY && (t < GRAB || t >= RELEASE))
  const hook = useAt((t) => (t >= EDIT ? 1 : 0))
  const flash = useAt((t) => Math.round(kf(t, [[FLASH[0], 0], [FLASH[1], 1], [FLASH[2], 0]]) * 20) / 20)
  const edited = useAt((t) => Math.round(ramp(t, EDIT, EDIT + 0.3) * 10) / 10)
  return (
    <motion.div className="absolute font-sans" style={{ left: PLAYER.x, top: PLAYER.y - 22, width: PLAYER_W, opacity }}>
      <div className="mb-1.5 pl-0.5 text-[11.5px] font-medium text-white/55">LaunchVideo</div>
      <div className="relative overflow-hidden rounded-[10px] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.08]" style={{ height: PLAYER_H }}>
        <Skeleton />
        {built && (
          <motion.div className="absolute inset-0" style={{ clipPath }}>
            <Player v={v} playing={playing} hook={hook} flash={flash} edited={edited} />
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}

function Pointer() {
  const x = useTrack((t) => you(t)[0])
  const y = useTrack((t) => you(t)[1])
  const opacity = useTrack((t) => ramp(t, 0.3, 0.6) * (1 - ramp(t, 16.0, 16.4)))
  const press = useTrack((t) => 1 - 0.16 * Math.max(...CLICKS.map((c) => Math.sin(Math.PI * ramp(t, c - 0.08, c + 0.12, E.linear))), t >= GRAB && t < RELEASE ? ramp(t, GRAB - 0.05, GRAB + 0.1) * 0.6 : 0))
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

export function UseCaseMarketingVideoScene({ className }: { className?: string }) {
  return (
    <Scene width={W} height={H} duration={DUR} still={STILL} className={className}>
      <MotionSeek />
      <Fade>
        <Chat />
        <Component i={0}>
          <TrailMap />
        </Component>
        <Component i={1}>
          <TrailCard />
        </Component>
        <Component i={2}>
          <SaveOffline />
        </Component>
        <LaunchVideoFrame />
        <Pointer />
      </Fade>
      <style>{`@keyframes mv-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .mv-caret { animation: mv-caret 1s step-end infinite }
@keyframes mv-pop { from { opacity: 0; transform: scale(.85) } } .mv-pop { animation: mv-pop .25s cubic-bezier(.22,1,.36,1) both }`}</style>
    </Scene>
  )
}

export default function UseCaseMarketingVideo() {
  return (
    <ScenePage label="Marketers · Launch videos with Remotion">
      <UseCaseMarketingVideoScene />
    </ScenePage>
  )
}
