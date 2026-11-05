/**
 * "Launch videos with Remotion" pieces, for Fernway (the made-up offline
 * trail-map app of heroes.tsx, in its editorial palette):
 *
 *  - TrailMap, TrailCard, SaveOffline   three real product components, as
 *                    they sit on the canvas (300×150 each). SaveOffline's
 *                    button can be pressed and fill as the area saves.
 *  - LaunchVideo     the Remotion composition the agent builds from them
 *                    (960×540, played by `v` in video seconds): Hook /
 *                    Feature / Product UI (a zoom on Save offline) / CTA.
 *                    `hook` picks the first or the edited headline.
 *  - Player          the LaunchVideo frame: a 16:9 preview, a control bar
 *                    and a timeline of scene blocks with a playhead.
 *
 * PLAYER_* and HEAD_* are in player px, so a scene can aim at the playhead.
 */
import type { ReactNode } from "react"
import { Blocks, Check, Download, Pause, Play } from "lucide-react"

import { cn } from "@/lib/utils"
import { E, kf, ramp } from "../../motion/canvas-ai/kit"

/** Fernway's editorial palette (heroes.tsx HeroEditorial). */
export const FW = { cream: "#f3efe6", forest: "#1f3a2a", ink: "#1f2a22", moss: "#5f7a4a", amber: "#c9822b", sage: "#e6e9dc" }

export const C_W = 300
export const C_H = 150

/** Fernway's mark: a fern frond. */
export function FernwayMark({ size = 24, color = FW.cream }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeLinecap="round" aria-hidden="true">
      <path d="M12 22 C 12 15, 12.4 9, 14 2.5" strokeWidth="1.8" />
      {[0, 1, 2, 3, 4].map((i) => {
        const y = 18.5 - i * 3.2
        const x = 12 + i * 0.32
        const l = 6.4 - i * 1.05
        return (
          <g key={i} strokeWidth="1.7">
            <path d={`M${x} ${y} q ${-l * 0.55} ${-0.4} ${-l} ${-l * 0.55}`} />
            <path d={`M${x + 0.1} ${y - 1.2} q ${l * 0.55} ${-0.4} ${l} ${-l * 0.55}`} />
          </g>
        )
      })}
    </svg>
  )
}

/* ── The product components ─────────────────────────────────────────────── */

/** Signal bars, all empty: no signal. */
function NoBars({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 3} y={9 - i * 2.4} width="2" height={3 + i * 2.4} rx="0.6" opacity="0.32" />
      ))}
      <path d="M1 1.5 L11 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const ROUTE = "M34 118 C 62 104, 70 84, 98 80 S 140 92, 160 70 S 198 30, 232 40 S 268 74, 252 98"

/** The trail on a topo map, with where you are. `chrome` off drops the pills (for a full-bleed backdrop). */
export function TrailMap({ chrome = true }: { chrome?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-[14px] font-sans" style={{ width: C_W, height: C_H, background: FW.sage }}>
      <svg viewBox="0 0 300 150" className="absolute inset-0 size-full">
        {Array.from({ length: 9 }, (_, i) => (
          <ellipse key={i} cx={196} cy={58} rx={22 + i * 19} ry={12 + i * 12} fill="none" stroke={FW.forest} strokeOpacity={i % 4 === 0 ? 0.2 : 0.09} strokeWidth="1" vectorEffect="non-scaling-stroke" transform={`rotate(-14 196 58)`} />
        ))}
        {Array.from({ length: 4 }, (_, i) => (
          <ellipse key={`b${i}`} cx={46} cy={150} rx={30 + i * 22} ry={18 + i * 14} fill="none" stroke={FW.forest} strokeOpacity={0.08} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        ))}
        <path d="M0 40 C 40 52, 60 30, 96 44 S 150 120, 196 128 S 270 140, 300 132" fill="none" stroke="#7fa7b8" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={ROUTE} fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" />
        <path d={ROUTE} fill="none" stroke={FW.amber} strokeWidth="3" strokeLinecap="round" />
        {chrome && <circle cx="34" cy="118" r="5" fill={FW.forest} stroke="#fff" strokeWidth="2" />}
        <circle cx="160" cy="70" r="9" fill="#2f7de1" fillOpacity="0.18" />
        <circle cx="160" cy="70" r="4.5" fill="#2f7de1" stroke="#fff" strokeWidth="2" />
      </svg>
      {chrome && (
        <>
          <span className="absolute top-2.5 left-2.5 flex items-center gap-1 rounded-full px-2 py-[3px] text-[10.5px] font-semibold" style={{ background: "rgba(31,42,34,0.86)", color: FW.cream }}>
            <NoBars size={11} />
            No signal
          </span>
          <span className="absolute right-2.5 bottom-2 flex items-center gap-1 text-[9.5px] font-semibold" style={{ color: FW.ink }}>
            <span className="h-[3px] w-6 border-x border-b" style={{ borderColor: FW.ink }} />1 km
          </span>
        </>
      )}
    </div>
  )
}

/** A dawn ridge, the trail's thumbnail. */
function RidgePhoto({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className="shrink-0 rounded-[10px]">
      <defs>
        <linearGradient id="ol-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4d3a4" />
          <stop offset="1" stopColor="#d9dfcf" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill="url(#ol-sky)" />
      <circle cx="44" cy="22" r="7" fill="#fbe7c4" />
      <path d="M0 40 L14 28 L24 34 L38 20 L52 32 L64 26 L64 64 L0 64 Z" fill="#8fa38e" />
      <path d="M0 48 L12 40 L26 46 L40 36 L56 46 L64 42 L64 64 L0 64 Z" fill="#4f6b56" />
      <path d="M0 64 L0 54 L18 50 L34 56 L50 50 L64 54 L64 64 Z" fill={FW.forest} />
      {[8, 14, 46, 54].map((x, i) => (
        <path key={x} d={`M${x} ${56 - (i % 2) * 3} l3 -9 l3 9 Z`} fill="#16291e" />
      ))}
    </svg>
  )
}

const PROFILE = [12, 14, 19, 26, 31, 30, 36, 44, 52, 50, 56, 62, 60, 51, 44, 40, 33, 27, 22, 18, 14, 12]

/** A trail as a card: photo, name, stats and its elevation profile. */
export function TrailCard() {
  const pts = PROFILE.map((h, i) => `${(i / (PROFILE.length - 1)) * 276},${40 - (h / 64) * 34}`).join(" ")
  return (
    <div className="flex flex-col rounded-[14px] bg-white p-3 font-sans shadow-[0_1px_0_rgba(31,42,34,0.06)]" style={{ width: C_W, height: C_H, color: FW.ink }}>
      <div className="flex gap-3">
        <RidgePhoto size={58} />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[15px] leading-tight font-semibold">Kettle Ridge Loop</span>
            <span className="rounded-full px-1.5 py-px text-[10px] font-semibold" style={{ background: "#f6e7cf", color: "#8a5517" }}>
              Moderate
            </span>
          </div>
          <div className="mt-0.5 text-[11.5px] opacity-55">Mt. Tamalpais · 2.1 km away</div>
          <div className="mt-1.5 flex gap-2.5 text-[11.5px] font-semibold tabular-nums">
            <span>14.2 km</span>
            <span className="opacity-30">·</span>
            <span>620 m up</span>
            <span className="opacity-30">·</span>
            <span>3h 10m</span>
          </div>
        </div>
      </div>
      <svg viewBox="0 0 276 42" className="mt-auto h-[42px] w-full">
        <polygon points={`0,42 ${pts} 276,42`} fill={FW.forest} fillOpacity="0.08" />
        <polyline points={pts} fill="none" stroke={FW.forest} strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx={(11 / (PROFILE.length - 1)) * 276} cy={40 - (62 / 64) * 34} r="2.6" fill={FW.amber} />
      </svg>
    </div>
  )
}

/** The Save offline button, in component px (what the video zooms on). */
export const SAVE_BTN = { x: 12, y: 94, w: 276, h: 44 }
const MB = 38

/**
 * Saves the trail's area for no-signal use. `press` 0→1 squeezes the button;
 * `p` 0→1 fills it as the area saves; at 1 it reads "Ready offline".
 */
export function SaveOffline({ press = 0, p = 0 }: { press?: number; p?: number }) {
  const saving = p > 0 && p < 1
  const done = p >= 1
  return (
    <div className="relative rounded-[14px] bg-white font-sans shadow-[0_1px_0_rgba(31,42,34,0.06)]" style={{ width: C_W, height: C_H, color: FW.ink }}>
      <div className="flex gap-3 p-3">
        <div className="relative size-[52px] shrink-0 overflow-hidden rounded-[10px]" style={{ background: FW.sage }}>
          <svg viewBox="0 0 52 52" className="absolute inset-0 size-full">
            {[0, 1, 2, 3].map((i) => (
              <ellipse key={i} cx="30" cy="22" rx={6 + i * 7} ry={4 + i * 5} fill="none" stroke={FW.forest} strokeOpacity="0.14" />
            ))}
            <path d="M6 42 C 16 36, 20 28, 28 26 S 40 18, 46 12" fill="none" stroke={FW.amber} strokeWidth="2" strokeLinecap="round" />
            <rect x="8" y="8" width="36" height="36" rx="3" fill="none" stroke={FW.forest} strokeWidth="1.4" strokeDasharray="3 2.5" />
          </svg>
        </div>
        <div className="min-w-0 flex-1 pt-1">
          <div className="text-[14px] leading-tight font-semibold">Save Kettle Ridge offline</div>
          <div className="mt-1 text-[11.5px] leading-snug opacity-55">Topo, trails and water sources · {MB} MB</div>
        </div>
      </div>
      <div
        className="absolute flex items-center justify-center gap-2 overflow-hidden rounded-[11px] text-[14px] font-semibold"
        style={{
          left: SAVE_BTN.x,
          top: SAVE_BTN.y,
          width: SAVE_BTN.w,
          height: SAVE_BTN.h,
          transform: `scale(${1 - press * 0.04})`,
          background: done ? "#dfe9d6" : saving ? "rgba(31,58,42,0.10)" : FW.forest,
          color: done || saving ? FW.forest : FW.cream,
        }}
      >
        {saving && <span className="absolute inset-y-0 left-0" style={{ width: `${p * 100}%`, background: "rgba(31,58,42,0.18)" }} />}
        <span className="relative flex items-center gap-2 tabular-nums">
          {done ? (
            <>
              <span className="grid size-[18px] place-items-center rounded-full" style={{ background: FW.forest }}>
                <Check size={11} strokeWidth={3.2} color={FW.cream} />
              </span>
              Ready offline
            </>
          ) : saving ? (
            <>Saving · {Math.round(p * MB)} of {MB} MB</>
          ) : (
            <>
              <Download size={15} strokeWidth={2.4} />
              Save offline
            </>
          )}
        </span>
      </div>
    </div>
  )
}

/* ── The composition ────────────────────────────────────────────────────── */

export const VIDEO_W = 960
export const VIDEO_H = 540
export const VIDEO_LEN = 15
export const FPS = 30

export const SCENES = [
  { name: "Hook", from: 0, to: 3, uses: "TrailMap" },
  { name: "Feature", from: 3, to: 6, uses: "TrailCard" },
  { name: "Product UI", from: 6, to: 10, uses: "SaveOffline" },
  { name: "CTA", from: 10, to: 15, uses: "Fernway brand" },
] as const

export const HOOKS = [
  ["Out of signal.", "Still on the map."],
  ["Lose the signal,", "not the trail."],
] as const

/** A component placed in the video at `s`× its canvas size. */
const Place = ({ x, y, s, opacity = 1, dy = 0, children }: { x: number; y: number; s: number; opacity?: number; dy?: number; children: ReactNode }) => (
  <div className="absolute origin-top-left" style={{ left: x, top: y + dy, width: C_W, height: C_H, transform: `scale(${s})`, opacity }}>
    {children}
  </div>
)

const rise = (v: number, a: number, d = 0.6) => ({ opacity: ramp(v, a, a + d * 0.7, E.linear), dy: 26 * (1 - ramp(v, a, a + d, E.out)) })

// Where the components sit in the Feature scene, and the zoom onto Save offline.
const CS = 1.3
const CARD_AT = { x: 512, y: 66 }
const SAVE_AT = { x: 512, y: 280 }
const BTN_C = { x: SAVE_AT.x + (SAVE_BTN.x + SAVE_BTN.w / 2) * CS, y: SAVE_AT.y + (SAVE_BTN.y + SAVE_BTN.h / 2) * CS }
const ZOOM_TO = { x: 480, y: 306, s: 2.0 }
const TAP = 7.4
const SAVE = [7.6, 8.9] as const

/** The Remotion composition at `v` seconds (frame = round(v × 30)). `hook` 1 is the edited headline. */
export function LaunchVideo({ v, hook = 0 }: { v: number; hook?: 0 | 1 }) {
  // Hook → Feature: the cream scene slides up over the map. Product UI → CTA: a crossfade.
  const up = ramp(v, 2.8, 3.3, E.inOut)
  const cta = ramp(v, 9.9, 10.25, E.linear)
  const zoom = ramp(v, 6.0, 7.1, E.inOut)
  const z = 1 + (ZOOM_TO.s - 1) * zoom
  const press = Math.sin(Math.PI * ramp(v, TAP - 0.05, TAP + 0.2, E.linear))
  const p = ramp(v, SAVE[0], SAVE[1], E.linear)
  const lines = HOOKS[hook]
  return (
    <div className="relative overflow-hidden font-sans" style={{ width: VIDEO_W, height: VIDEO_H, background: FW.forest }}>
      {/* Hook: the map, full bleed under the headline. */}
      {up < 1 && (
        <div className="absolute inset-0">
          <div className="absolute" style={{ left: VIDEO_W / 2 - C_W / 2, top: VIDEO_H / 2 - C_H / 2, transform: `scale(${3.7 + 0.25 * ramp(v, 0, 3, E.linear)})` }}>
            <TrailMap chrome={false} />
          </div>
          <div className="absolute inset-0" style={{ background: "linear-gradient(90deg, rgba(18,34,25,0.88) 0%, rgba(18,34,25,0.66) 60%, rgba(18,34,25,0.4) 100%)" }} />
          <div className="absolute top-10 left-12 flex items-center gap-2.5" style={{ opacity: ramp(v, 0.05, 0.4) }}>
            <FernwayMark size={28} />
            <span className="font-serif text-[28px] italic" style={{ color: FW.cream }}>
              Fernway
            </span>
          </div>
          <div className="absolute top-10 right-12 flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[17px] font-semibold" style={{ background: FW.amber, color: "#2a1a08", opacity: ramp(v, 1.3, 1.5, E.linear), transform: `scale(${0.8 + 0.2 * ramp(v, 1.3, 1.7, E.pop)})` }}>
            <NoBars size={16} />
            No signal
          </div>
          <div className="absolute bottom-[64px] left-12 font-serif text-[76px] leading-[1.02] tracking-[-0.02em]" style={{ color: FW.cream }}>
            {lines.map((l, i) => {
              const r = rise(v, 0.3 + i * 0.4, 0.7)
              return (
                <div key={l} style={{ opacity: r.opacity, transform: `translateY(${r.dy}px)` }} className={cn(i === 1 && "italic")}>
                  {l}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Feature + Product UI: one cream stage; the camera pushes in on Save offline. */}
      {up > 0 && cta < 1 && (
        <div className="absolute inset-0 overflow-hidden" style={{ background: FW.cream, transform: `translateY(${(1 - up) * VIDEO_H}px)` }}>
          <div className="absolute inset-0 origin-top-left" style={{ transform: `translate(${(ZOOM_TO.x - BTN_C.x) * zoom}px, ${(ZOOM_TO.y - BTN_C.y) * zoom}px)` }}>
            <div className="absolute inset-0" style={{ transformOrigin: `${BTN_C.x}px ${BTN_C.y}px`, transform: `scale(${z})` }}>
              <div className="absolute top-[150px] left-14 w-[400px]" style={{ color: FW.ink, opacity: 1 - ramp(v, 5.9, 6.4, E.linear) }}>
                {(() => {
                  const a = rise(v, 3.25, 0.6)
                  const b = rise(v, 3.45, 0.6)
                  return (
                    <>
                      <div className="text-[14px] font-semibold tracking-[0.2em] uppercase" style={{ color: FW.amber, opacity: a.opacity, transform: `translateY(${a.dy}px)` }}>
                        New in Fernway 5.2
                      </div>
                      <div className="mt-3 font-serif text-[64px] leading-[1] tracking-[-0.02em]" style={{ opacity: a.opacity, transform: `translateY(${a.dy}px)` }}>
                        Offline maps.
                      </div>
                      <div className="mt-5 text-[22px] leading-[1.4] opacity-70" style={{ opacity: 0.7 * b.opacity, transform: `translateY(${b.dy}px)` }}>
                        Save any trail before you lose signal. It works with no bars at all.
                      </div>
                    </>
                  )
                })()}
              </div>
              <Place x={CARD_AT.x} y={CARD_AT.y} s={CS} {...rise(v, 3.5, 0.7)}>
                <div className="rounded-[14px] shadow-[0_10px_28px_-14px_rgba(31,42,34,0.35)]">
                  <TrailCard />
                </div>
              </Place>
              <Place x={SAVE_AT.x} y={SAVE_AT.y} s={CS} {...rise(v, 3.95, 0.7)}>
                <div className="rounded-[14px] shadow-[0_10px_28px_-14px_rgba(31,42,34,0.35)]">
                  <SaveOffline press={press} p={p} />
                </div>
              </Place>
            </div>
          </div>
          {/* The tap, and the line under the zoom. */}
          {v >= TAP - 0.3 && v < TAP + 0.6 && (
            <span
              className="absolute size-[56px] rounded-full border-[3px] border-white bg-white/40 shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
              style={{ left: ZOOM_TO.x - 28, top: ZOOM_TO.y - 28, opacity: ramp(v, TAP - 0.3, TAP - 0.15, E.linear) * (1 - ramp(v, TAP + 0.3, TAP + 0.6, E.linear)), transform: `scale(${1 - 0.25 * press})` }}
            />
          )}
          <div className="absolute inset-x-0 bottom-[46px] text-center font-serif text-[34px] tracking-[-0.01em]" style={{ color: FW.ink, opacity: ramp(v, 8.3, 8.7, E.linear), transform: `translateY(${16 * (1 - ramp(v, 8.3, 8.9, E.out))}px)` }}>
            One tap, {MB} MB, <span className="italic">and you're covered.</span>
          </div>
        </div>
      )}

      {/* CTA: the end card. */}
      {cta > 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: FW.forest, opacity: cta, color: FW.cream }}>
          {(() => {
            const a = rise(v, 10.05, 0.55)
            const b = rise(v, 10.3, 0.55)
            const c = rise(v, 10.55, 0.55)
            return (
              <>
                <div className="flex items-center gap-4" style={{ opacity: a.opacity, transform: `translateY(${a.dy}px)` }}>
                  <FernwayMark size={64} />
                  <span className="font-serif text-[84px] leading-none italic">Fernway</span>
                </div>
                <div className="mt-8 text-[32px] font-medium tracking-[-0.01em]" style={{ opacity: b.opacity, transform: `translateY(${b.dy}px)` }}>
                  Offline maps are here.
                </div>
                <div className="mt-3 text-[19px] opacity-60" style={{ opacity: 0.6 * c.opacity, transform: `translateY(${c.dy}px)` }}>
                  Free on every plan · Fernway 5.2 for iOS and Android
                </div>
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

/* ── The player frame ───────────────────────────────────────────────────── */

export const PLAYER_W = 532
const PREVIEW_H = Math.round((PLAYER_W * VIDEO_H) / VIDEO_W)
const BAR_H = 34
const RULER_H = 18
const LANE_H = 40
export const PLAYER_H = PREVIEW_H + BAR_H + RULER_H + LANE_H + 12
const TRACK_X = 12
const TRACK_W = PLAYER_W - TRACK_X * 2
/** The playhead's grab handle at `v` seconds, in player px. */
export const HEAD_AT = (v: number): [number, number] => [TRACK_X + (v / VIDEO_LEN) * TRACK_W, PREVIEW_H + BAR_H + 6]

const tc = (v: number) => {
  const f = Math.min(VIDEO_LEN * FPS, Math.round(v * FPS))
  return `0:${String(Math.floor(f / FPS)).padStart(2, "0")}.${String(f % FPS).padStart(2, "0")}`
}
const BLOCK = ["#2f5240", "#4d6a3e", "#8a6430", "#3d4743"]

/**
 * The LaunchVideo frame. `v` is the playhead (seconds), `playing` swaps the
 * play/pause icon, `hook` is the headline take, `flash` 0→1 marks a scene
 * block the agent just edited (`edited`).
 */
export function Player({ v, playing, hook = 0, flash = 0, edited = 0 }: { v: number; playing: boolean; hook?: 0 | 1; flash?: number; edited?: number }) {
  const frame = Math.min(VIDEO_LEN * FPS, Math.round(v * FPS))
  const x = TRACK_X + (v / VIDEO_LEN) * TRACK_W
  const active = SCENES.findIndex((s) => v >= s.from && (v < s.to || s.to === VIDEO_LEN))
  return (
    <div className="relative overflow-hidden rounded-[10px] bg-[#181818] font-sans" style={{ width: PLAYER_W, height: PLAYER_H }}>
      <div className="relative overflow-hidden bg-black" style={{ width: PLAYER_W, height: PREVIEW_H }}>
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `scale(${PLAYER_W / VIDEO_W})` }}>
          <LaunchVideo v={v} hook={hook} />
        </div>
      </div>
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-3 text-[11px] text-white/45 tabular-nums" style={{ height: BAR_H }}>
        <span className="grid size-[22px] place-items-center rounded-full bg-white/[0.08] text-white/85">{playing ? <Pause size={10} fill="currentColor" strokeWidth={0} /> : <Play size={10} fill="currentColor" strokeWidth={0} className="translate-x-[1px]" />}</span>
        <span className="font-mono text-[11px] text-white/85">{tc(v)}</span>
        <span className="font-mono text-[11px]">/ 0:15.00</span>
        <span className="ml-auto">
          Frame <span className="font-mono text-white/70">{frame}</span> of 450
        </span>
        <span className="text-white/25">·</span>
        <span>1920×1080 · 30 fps</span>
      </div>
      <div className="relative" style={{ height: RULER_H + LANE_H + 12 }}>
        <div className="absolute inset-x-0 top-0" style={{ height: RULER_H }}>
          {Array.from({ length: VIDEO_LEN + 1 }, (_, s) => (
            <div key={s} className="absolute bottom-0" style={{ left: TRACK_X + (s / VIDEO_LEN) * TRACK_W }}>
              <div className={cn("absolute bottom-0 w-px", s % 5 === 0 ? "h-[7px] bg-white/30" : "h-[4px] bg-white/15")} />
              {s % 5 === 0 && s < VIDEO_LEN && <div className="absolute bottom-[3px] left-[4px] font-mono text-[9px] text-white/35">0:{String(s).padStart(2, "0")}</div>}
            </div>
          ))}
        </div>
        {SCENES.map((s, i) => {
          const left = TRACK_X + (s.from / VIDEO_LEN) * TRACK_W + 1
          const w = ((s.to - s.from) / VIDEO_LEN) * TRACK_W - 2
          return (
            <div
              key={s.name}
              className="absolute flex flex-col justify-center overflow-hidden rounded-[5px] px-2"
              style={{ left, width: w, top: RULER_H + 6, height: LANE_H, background: BLOCK[i], boxShadow: active === i ? "inset 0 0 0 1.5px rgba(255,255,255,0.85)" : "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
            >
              {i === 0 && flash > 0 && <span className="absolute inset-0 bg-white" style={{ opacity: flash * 0.35 }} />}
              <span className="relative flex items-center gap-1.5 text-[11px] leading-tight font-semibold text-white/90">
                {s.name}
                {i === 0 && edited > 0 && <span className="size-[5px] rounded-full" style={{ background: "#f2c38a", opacity: edited }} />}
              </span>
              <span className="relative mt-0.5 flex items-center gap-1 truncate text-[9.5px] text-white/50">
                <Blocks size={9} className="shrink-0" strokeWidth={2} />
                <span className="truncate">{s.uses}</span>
              </span>
            </div>
          )
        })}
        <div className="pointer-events-none absolute top-0 bottom-1" style={{ left: x }}>
          <div className="absolute top-0 bottom-0 -left-px w-[2px] bg-white" />
          <div className="absolute top-0 -left-[6px] h-[12px] w-[12px] rounded-b-[4px] rounded-t-[2px] bg-white" />
        </div>
      </div>
    </div>
  )
}
