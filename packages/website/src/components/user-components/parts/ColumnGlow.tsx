/**
 * ColumnGlow — a band of tall glowing columns, from the Milana landing page,
 * as a background you can tune and drop anywhere.
 *
 * Every column is a vertical gradient through `colors` (top to bottom).
 * Columns start at different heights, neighbours alternate bright and dim
 * like a row of stage lights, the outer columns hold the first colours longer,
 * and a blurred copy on top makes them glow. The top fades into the page.
 * `arc` drops the tops toward the edges in a rough curve. `soften` melts the columns into each other: they widen and overlap with
 * feathered sides and tops, and blur, until no single bar shows. It's plain
 * CSS (no canvas), and the slow breathing stops for reduced motion.
 *
 *   <ColumnGlow className="h-[640px]" colors={["#1c2b55", "#3a5fb0", "#d97757", "#e6ecf8"]}>
 *     <Card />
 *   </ColumnGlow>
 *
 * The default export is a playground: tune it, then copy the JSX.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Check, Copy, Minus, Plus, Shuffle } from "lucide-react"
import interUrl from "../landing/InterVariable.woff2?url"

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ")

/* ── Component ────────────────────────────────────────────────────────── */

export type ColumnGlowProps = {
  /** Two to eight colours, top to bottom. */
  colors?: string[]
  columns?: number
  /** Where the gradient starts, as a share of the height (0–0.6). */
  start?: number
  /** How much of the height the colours span (0.2–1). */
  spread?: number
  /** How much later the outer columns change colour, in % of height. */
  edge?: number
  /** Random shift of each column's colours, in % of height. */
  jitter?: number
  /** How far down the stepped columns start, in % of height. */
  stagger?: number
  /** Share of columns that run the full height (0–1). */
  full?: number
  /** Shapes the tops into a rough arc: how far the edge columns drop, in % of height (0–70). Each column's drop is jittered, so it never reads as a perfect curve. */
  arc?: number
  /** How dark every other column is (0–0.8). */
  dim?: number
  /** Melts the columns together (0–1): wider, overlapping, feathered, blurred. 0 keeps crisp bars. */
  soften?: number
  /** Blur of the glow layer, px. 0 turns the glow off. */
  glow?: number
  /** Opacity of the glow layer (0–1). */
  glowOpacity?: number
  /** Fade at the top, in % of height. */
  fadeTop?: number
  /** Fade at the bottom, in % of height. */
  fadeBottom?: number
  /** How far the columns sink as they breathe (0–0.3). 0 holds them still. */
  motion?: number
  /** Breathing speed multiplier. */
  speed?: number
  /** Changes the pattern while keeping the style. */
  seed?: number
  /** Colour behind the columns; transparent to sit on your own. */
  background?: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export const COLUMN_GLOW_DEFAULTS = {
  colors: ["#1c2b55", "#3a5fb0", "#6286d8", "#a77396", "#d97757", "#f2b896", "#e6ecf8", "#ffffff"],
  columns: 30,
  start: 0.02,
  spread: 0.68,
  edge: 22,
  jitter: 8,
  stagger: 26,
  full: 0.35,
  arc: 0,
  dim: 0.34,
  soften: 0,
  glow: 22,
  glowOpacity: 0.55,
  fadeTop: 24,
  fadeBottom: 0,
  motion: 0.08,
  speed: 1,
  seed: 0,
  background: "#262626",
} satisfies Omit<ColumnGlowProps, "className" | "style" | "children">

const rand = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/**
 * The breathing, one keyframes rule per depth. The depth is written into the keyframes, not read from a
 * custom property there: keyframes that use var() can't run on the compositor, so 80 bars would each
 * need a style pass on every frame.
 */
/** How many independent breathing groups the columns are dealt into. */
const VOICES = 8
const breathing = (amp: number) => {
  const name = `ad-column-glow-${Math.round(amp * 1000)}`
  const css = `
@keyframes ${name} { 0%, 100% { transform: scaleY(1); } 50% { transform: scaleY(${(1 - amp).toFixed(3)}); } }
@media (prefers-reduced-motion: no-preference) { .${name} { animation: ${name} var(--d) ease-in-out var(--l) infinite; } }
[data-offscreen] .${name} { animation-play-state: paused; }
`
  return { name, css }
}

export function ColumnGlow(props: ColumnGlowProps) {
  const p = { ...COLUMN_GLOW_DEFAULTS, ...props }
  // The columns breathe only while the band is on screen: 160 animated bars under a blur cost a lot to keep repainting.
  const root = useRef<HTMLDivElement>(null)
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting))
    io.observe(root.current!)
    return () => io.disconnect()
  }, [])
  const { columns, seed } = p
  const colors = p.colors.length >= 2 ? p.colors.slice(0, 8) : [p.colors[0] ?? "#3a5fb0", p.colors[0] ?? "#3a5fb0"]

  const bars = useMemo(
    () =>
      Array.from({ length: columns }, (_, i) => {
        const s = i + 1 + seed * 997
        const r = rand(s)
        const edge = columns > 1 ? Math.abs(i - (columns - 1) / 2) / ((columns - 1) / 2) : 0
        // Neighbours alternate bright and dim; the dimming fades out toward
        // the bottom so the last colour stays even.
        const dim = (i % 2 ? p.dim : p.dim * 0.12) + r * 0.12 * Math.min(1, p.dim * 3)
        // The arc drops the tops toward the edges along a curve, each column a
        // little more or less than its neighbours; the random steps sit on top.
        // `k` is this column's share of `arc`, `step` its drop without it: its top sits at min(94, arc × k + step)%.
        const k = Math.pow(edge, 1.7) * (0.78 + rand(s + 200) * 0.44)
        const step = r < p.full ? 0 : 4 + rand(s + 40) * Math.max(0, p.stagger - 4)
        // Outer columns hold the first colours longer.
        const from = p.start * 100 + edge * p.edge + rand(s + 80) * p.jitter
        const stops = colors.map((c, k) => `${c} ${Math.min(100, from + (p.spread * 100 * k) / (colors.length - 1)).toFixed(1)}%`)
        // Rounded: rand() magnifies Math.sin's last digits, which differ between Node and the browser, and the
        // server-rendered page has to match the browser's render exactly.
        const shade = `linear-gradient(180deg, rgba(10,12,20,${dim.toFixed(4)}) 0%, rgba(10,12,20,${(dim * 0.8).toFixed(4)}) 55%, rgba(10,12,20,0) 88%)`
        const background = `${shade}, linear-gradient(180deg, ${colors[0]} 0%, ${stops.join(", ")}, ${colors[colors.length - 1]} 100%)`
        // Rounded for the same reason as `shade`.
        return { k: +k.toFixed(4), step: +step.toFixed(3), background }
      }),
    [columns, seed, colors.join(), p.start, p.spread, p.edge, p.jitter, p.stagger, p.full, p.dim],
  )
  // The columns breathe in VOICES groups, interleaved (column i in voice i % VOICES), each on its own
  // period and phase, so neighbours never move together. One animated layer per voice instead of one per
  // column: 16 animated elements in place of 80 is most of what the band costs while anything near it moves.
  const voices = useMemo(
    () =>
      Array.from({ length: Math.min(VOICES, columns) }, (_, v) => {
        const s = v + 1 + seed * 997
        return { d: `${((7 + rand(s + 120) * 6) / Math.max(0.05, p.speed)).toFixed(3)}s`, l: `${(-rand(s + 160) * 10).toFixed(3)}s` }
      }),
    [columns, seed, p.speed],
  )

  const fade = `linear-gradient(180deg, transparent 0%, #000 ${p.fadeTop}%, #000 ${100 - p.fadeBottom}%, ${p.fadeBottom ? "transparent" : "#000"} 100%)`

  // Softened, each column spills into its neighbours with feathered sides and
  // a feathered top, so the overlaps cross-fade instead of meeting at an edge.
  const spill = p.soften * 70
  const side = `linear-gradient(90deg, transparent 0%, #000 ${p.soften * 40}%, #000 ${100 - p.soften * 40}%, transparent 100%)`
  const crown = `linear-gradient(180deg, transparent 0%, #000 ${p.soften * 140}px)`
  const soft = p.soften > 0
  const breathe = breathing(p.motion)

  // The columns, built once per pattern and shared by both layers: changing `arc` (which the canvas
  // landing animates) only moves the --cg-arc custom property on the root, so React re-renders nothing
  // below it. Crisp columns take their tops as a scaleY from the bottom, which the compositor
  // applies without layout or repaint. Softened ones keep `top`, so their feathered crowns aren't squashed.
  const cols = useMemo(() => {
    const feather: CSSProperties = soft
      ? { left: `-${spill}%`, right: `-${spill}%`, maskImage: `${side}, ${crown}`, WebkitMaskImage: `${side}, ${crown}`, maskComposite: "intersect", WebkitMaskComposite: "source-in" }
      : {}
    const top = (b: (typeof bars)[number]) => `min(94, var(--cg-arc) * ${b.k.toFixed(4)} + ${b.step.toFixed(3)})`
    const column = (b: (typeof bars)[number], i: number) => (
      <div
        key={i}
        className="absolute inset-y-0 origin-bottom"
        style={{ left: `${(i * 100) / columns}%`, width: `${100 / columns}%`, transform: soft ? undefined : `scaleY(calc(1 - ${top(b)} / 100))` }}
      >
        <div
          className={cx("absolute -inset-x-[0.5px] -bottom-1", soft ? null : "top-0")}
          style={{ ...(soft ? { top: `calc(${top(b)} * 1%)` } : null), background: b.background, ...feather }}
        />
      </div>
    )
    return voices.map((v, vi) => (
      <div key={vi} className={cx("absolute inset-0 origin-bottom", p.motion > 0 && breathe.name)} style={{ "--d": v.d, "--l": v.l } as CSSProperties}>
        {bars.map((b, i) => (i % voices.length === vi ? column(b, i) : null))}
      </div>
    ))
  }, [bars, voices, columns, soft, spill, side, crown, p.motion, breathe.name])

  const layer = (blur: number, opacity = 1) => (
    <div className={cx("absolute", blur ? "-inset-12" : "inset-0")} style={blur ? { filter: `blur(${blur}px)`, opacity } : undefined}>
      {cols}
    </div>
  )

  return (
    <div
      ref={root}
      data-offscreen={onScreen ? undefined : ""}
      className={cx("relative isolate overflow-hidden", p.className)}
      style={{ background: p.background, contain: "paint", ...p.style, "--cg-arc": p.arc } as CSSProperties}
    >
      <style>{breathe.css}</style>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ maskImage: fade, WebkitMaskImage: fade }}>
        {layer(p.soften * 18)}
        {p.glow > 0 && layer(p.glow + p.soften * 20, p.glowOpacity)}
      </div>
      {p.children}
    </div>
  )
}

/* ── Playground ───────────────────────────────────────────────────────── */

const PRESETS: { name: string; colors: string[] }[] = [
  { name: "Logo and Claude", colors: COLUMN_GLOW_DEFAULTS.colors },
  { name: "Logo", colors: ["#0f1a3a", "#1b3474", "#3a5fb0", "#6f93e0", "#b9cbf2", "#e6ecf8", "#ffffff"] },
  { name: "Claude", colors: ["#2a1712", "#7d3a26", "#d97757", "#eaa184", "#f6d3c2", "#fbefe8"] },
  { name: "Dusk", colors: ["#1b3474", "#4b4fa8", "#7c6cd6", "#c47aa8", "#d97757", "#f4d6c4"] },
  { name: "Milana", colors: ["#2a0a1f", "#7a1a4f", "#e0338a", "#ff5fb0", "#f5a3d0", "#e8ff7a"] },
  { name: "Mars", colors: ["#2a0d08", "#ff4d2e", "#ff9e3d", "#ffd27a", "#fff3d6"] },
  { name: "Glacier", colors: ["#0b1d33", "#2f6dbf", "#5b8cff", "#7ff3ff", "#e8fbff"] },
  { name: "Mono", colors: ["#1a1a1a", "#3a3a3a", "#737373", "#bdbdbd", "#f2f2f2"] },
]

type Settings = typeof COLUMN_GLOW_DEFAULTS

const SLIDERS: { key: keyof Omit<Settings, "colors" | "background">; label: string; min: number; max: number; step: number; group: string }[] = [
  { key: "columns", label: "Columns", min: 4, max: 80, step: 1, group: "Columns" },
  { key: "stagger", label: "Stagger", min: 0, max: 70, step: 1, group: "Columns" },
  { key: "full", label: "Full height", min: 0, max: 1, step: 0.01, group: "Columns" },
  { key: "arc", label: "Arc", min: 0, max: 70, step: 1, group: "Columns" },
  { key: "dim", label: "Alternate dim", min: 0, max: 0.8, step: 0.01, group: "Columns" },
  { key: "soften", label: "Soften", min: 0, max: 1, step: 0.01, group: "Columns" },
  { key: "start", label: "Start", min: 0, max: 0.6, step: 0.01, group: "Colour" },
  { key: "spread", label: "Spread", min: 0.2, max: 1, step: 0.01, group: "Colour" },
  { key: "edge", label: "Edge hold", min: 0, max: 60, step: 1, group: "Colour" },
  { key: "jitter", label: "Jitter", min: 0, max: 30, step: 1, group: "Colour" },
  { key: "glow", label: "Glow blur", min: 0, max: 60, step: 1, group: "Glow" },
  { key: "glowOpacity", label: "Glow opacity", min: 0, max: 1, step: 0.01, group: "Glow" },
  { key: "fadeTop", label: "Fade top", min: 0, max: 80, step: 1, group: "Glow" },
  { key: "fadeBottom", label: "Fade bottom", min: 0, max: 60, step: 1, group: "Glow" },
  { key: "motion", label: "Breathing", min: 0, max: 0.3, step: 0.01, group: "Motion" },
  { key: "speed", label: "Speed", min: 0.1, max: 4, step: 0.05, group: "Motion" },
]

const GROUPS = ["Columns", "Colour", "Glow", "Motion"]

export const Slider = ({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) => (
  <label className="flex flex-col gap-1.5">
    <span className="flex justify-between text-[11.5px]">
      <span className="text-neutral-400">{label}</span>
      <span className="text-neutral-200 tabular-nums">{step >= 1 ? value : value.toFixed(2)}</span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-white"
    />
  </label>
)

// Props that differ from the defaults, as JSX.
const toJsx = (s: Settings) => {
  const lines = (Object.keys(s) as (keyof Settings)[])
    .filter((k) => JSON.stringify(s[k]) !== JSON.stringify(COLUMN_GLOW_DEFAULTS[k]))
    .map((k) => (typeof s[k] === "string" ? `  ${k}="${s[k]}"` : `  ${k}={${JSON.stringify(s[k]).replace(/,/g, ", ")}}`))
  return `<ColumnGlow\n  className="h-[640px]"${lines.length ? "\n" + lines.join("\n") : ""}\n/>`
}

export type ColumnGlowSettings = Settings

/**
 * The tuning panel on its own (palette, colours, background, every slider,
 * new pattern, reset, copy JSX), so anything that shows a ColumnGlow can
 * offer it. `defaults` is what Reset goes back to and what Copy JSX diffs
 * against; `extra` slots in above the buttons (the playground's height).
 */
export function ColumnGlowControls({
  value: s,
  onChange,
  defaults = COLUMN_GLOW_DEFAULTS,
  extra,
  className,
}: {
  value: Settings
  onChange: (s: Settings) => void
  defaults?: Settings
  extra?: ReactNode
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v })
  const setColor = (i: number, c: string) => set("colors", s.colors.map((x, j) => (j === i ? c : x)))
  const preset = PRESETS.find((p) => p.colors.join() === s.colors.join())?.name

  const copy = () => {
    const text = toJsx(s)
    const done = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }
    navigator.clipboard?.writeText(text).then(done, () => {
      const ta = document.createElement("textarea")
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand("copy")
      ta.remove()
      done()
    })
  }

  return (
    <div className={cx("flex flex-col gap-6", className)}>
      <div className="flex items-center justify-between">
        <h1 className="text-[14px] font-medium">ColumnGlow</h1>
        <button type="button" onClick={copy} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-white px-2.5 text-[12px] font-medium text-[#171717]">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy JSX"}
        </button>
      </div>

      <section className="flex flex-col gap-2.5">
        <span className="flex justify-between text-[11.5px]">
          <span className="text-neutral-400">Palette</span>
          <span className="text-neutral-200">{preset ?? "Custom"}</span>
        </span>
        <div className="grid grid-cols-4 gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              title={p.name}
              onClick={() => set("colors", [...p.colors])}
              className={cx("h-7 rounded-md ring-offset-2 ring-offset-[#212121]", preset === p.name && "ring-2 ring-white")}
              style={{ background: `linear-gradient(180deg, ${p.colors.join(", ")})` }}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <span className="flex items-center justify-between text-[11.5px]">
          <span className="text-neutral-400">Colours, top to bottom</span>
          <span className="flex gap-1">
            <button
              type="button"
              aria-label="Remove the last colour"
              disabled={s.colors.length <= 2}
              onClick={() => set("colors", s.colors.slice(0, -1))}
              className="grid size-6 place-items-center rounded-md bg-white/[0.06] text-neutral-300 disabled:opacity-30"
            >
              <Minus className="size-3" />
            </button>
            <button
              type="button"
              aria-label="Add a colour"
              disabled={s.colors.length >= 8}
              onClick={() => set("colors", [...s.colors, s.colors[s.colors.length - 1]])}
              className="grid size-6 place-items-center rounded-md bg-white/[0.06] text-neutral-300 disabled:opacity-30"
            >
              <Plus className="size-3" />
            </button>
          </span>
        </span>
        {s.colors.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="color" value={c} onChange={(e) => setColor(i, e.target.value)} className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0" />
            <input
              value={c}
              onChange={(e) => /^#[0-9a-f]{0,6}$/i.test(e.target.value) && setColor(i, e.target.value)}
              className="h-7 min-w-0 flex-1 rounded-md bg-white/[0.05] px-2 font-mono text-[12px] text-neutral-200 outline-none focus:ring-1 focus:ring-white/20"
            />
          </div>
        ))}
        <div className="mt-1 flex items-center gap-2">
          <input
            type="color"
            value={s.background === "transparent" ? "#262626" : s.background}
            onChange={(e) => set("background", e.target.value)}
            className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
          />
          <span className="flex-1 text-[11.5px] text-neutral-400">Background</span>
          <button
            type="button"
            onClick={() => set("background", s.background === "transparent" ? "#262626" : "transparent")}
            className="h-6 rounded-md bg-white/[0.06] px-2 text-[11px] text-neutral-300"
          >
            {s.background === "transparent" ? "None" : s.background}
          </button>
        </div>
      </section>

      {GROUPS.map((g) => (
        <section key={g} className="flex flex-col gap-3">
          <span className="text-[11px] font-medium tracking-[0.08em] text-neutral-500 uppercase">{g}</span>
          {SLIDERS.filter((x) => x.group === g).map((x) => (
            <Slider key={x.key} label={x.label} min={x.min} max={x.max} step={x.step} value={s[x.key] as number} onChange={(v) => set(x.key, v)} />
          ))}
        </section>
      ))}

      <section className="flex flex-col gap-3">
        {extra}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => set("seed", s.seed + 1)}
            className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-white/[0.06] text-[12px] text-neutral-200"
          >
            <Shuffle className="size-3.5" />
            New pattern
          </button>
          <button type="button" onClick={() => onChange({ ...defaults, colors: [...defaults.colors] })} className="h-7 flex-1 rounded-md bg-white/[0.06] text-[12px] text-neutral-200">
            Reset
          </button>
        </div>
      </section>
    </div>
  )
}

export default function ColumnGlowPlayground() {
  const [s, setS] = useState<Settings>({ ...COLUMN_GLOW_DEFAULTS, colors: [...COLUMN_GLOW_DEFAULTS.colors] })
  const [height, setHeight] = useState(640)

  return (
    <div className="flex min-h-screen bg-[#1c1c1c] text-neutral-100 antialiased" style={{ fontFamily: '"Inter Variable", -apple-system, sans-serif' }}>
      <style>{`@font-face { font-family: "Inter Variable"; src: url("${interUrl}") format("woff2"); font-weight: 100 900; font-display: swap; }`}</style>

      <main className="min-w-0 flex-1 p-6">
        <ColumnGlow {...s} className="w-full rounded-[10px] ring-1 ring-white/[0.06]" style={{ height }} />
        <pre className="mt-4 overflow-x-auto rounded-lg bg-[#232323] p-4 font-mono text-[11.5px] leading-relaxed text-neutral-400 ring-1 ring-white/[0.06]">{toJsx(s)}</pre>
      </main>

      <aside className="sticky top-0 flex h-screen w-[300px] shrink-0 flex-col overflow-y-auto border-l border-white/[0.06] bg-[#212121] p-5">
        <ColumnGlowControls
          value={s}
          onChange={setS}
          extra={
            <>
              <span className="text-[11px] font-medium tracking-[0.08em] text-neutral-500 uppercase">Preview</span>
              <Slider label="Height" min={240} max={1000} step={10} value={height} onChange={setHeight} />
            </>
          }
        />
      </aside>
    </div>
  )
}
