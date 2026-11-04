/**
 * AuroraPlayground — just the aurora and its controls. The sky fills the
 * frame; one panel at the bottom tunes every prop <Aurora> takes: palette,
 * theme, curtains, speed, intensity, height, spread, rays and seed. No stars:
 * just the light.
 *
 * LandingAurora is the aurora with a smaller panel, for the essay landing:
 * transparent, sitting straight on the page, its controls always open.
 */
import { useLayoutEffect, useRef, useState } from "react"
import { Moon, Shuffle, Sun } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"
import { Aurora } from "./Aurora"

const PRESETS: { name: string; colors: string[] }[] = [
  { name: "Borealis", colors: ["#2bf39b", "#1fb6ff", "#7a5cff"] },
  { name: "Ember", colors: ["#ff5f6d", "#ffb36b", "#c04cfd"] },
  { name: "Glacier", colors: ["#7ff3ff", "#5b8cff", "#b3c4ff"] },
  { name: "Brand", colors: ["#7c5cff", "#ff4dd8", "#2dd4bf", "#4f7cff"] },
  { name: "Polar", colors: ["#3dff8f", "#2bd9a8", "#ff3d8b"] },
  { name: "Lagoon", colors: ["#00f5d4", "#00bbf9", "#3a86ff"] },
  { name: "Orchid", colors: ["#f15bb5", "#9b5de5", "#c77dff"] },
  { name: "Solstice", colors: ["#ffd166", "#ff7a59", "#ff3d7f"] },
  { name: "Verdant", colors: ["#a7f432", "#3ee07a", "#14b8a6"] },
  { name: "Nebula", colors: ["#ff6ad5", "#8c5cff", "#3fd0ff"] },
  { name: "Sakura", colors: ["#ffb7c5", "#ff8fab", "#d8a7ff"] },
  { name: "Abyss", colors: ["#00e5ff", "#2962ff", "#6a00f4"] },
  { name: "Mars", colors: ["#ff4d2e", "#ff9e3d", "#ffd27a"] },
  { name: "Mint", colors: ["#b8ffde", "#5cf2c4", "#7fd3ff"] },
  { name: "Citrus", colors: ["#fff275", "#ffb703", "#7cf29c"] },
  { name: "Dusk", colors: ["#ff9a8b", "#ff6a88", "#8e7dff"] },
  { name: "Vapor", colors: ["#ff71ce", "#01cdfe", "#05ffa1", "#b967ff"] },
  { name: "Moonlight", colors: ["#e8eeff", "#9fb4ff", "#c9b8ff"] },
]

const MARS = PRESETS.findIndex((p) => p.name === "Mars")

/** The landing page's aurora: Mars, four slow curtains high in the sky, no rays. */
export const LANDING_AURORA = {
  colors: PRESETS[MARS].colors,
  bands: 4,
  speed: 0.45,
  intensity: 1,
  height: 0.8,
  spread: 1,
  rays: 0,
  seed: 0,
}

const Label = ({ children, value, dark }: { children: string; value?: string; dark: boolean }) => (
  <span className={cn("flex justify-between text-[10px] font-semibold tracking-[0.12em] uppercase", dark ? "text-white/45" : "text-black/40")}>
    {children}
    {value && <span className={cn("tracking-normal tabular-nums", dark ? "text-white/80" : "text-black/70")}>{value}</span>}
  </span>
)

function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
  dark,
  className,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  dark: boolean
  className?: string
}) {
  return (
    <label className={cn("flex w-[118px] flex-col gap-1.5", className)}>
      <Label value={value.toFixed(2)} dark={dark}>
        {label}
      </Label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn("h-1 w-full cursor-pointer appearance-none rounded-full", dark ? "bg-white/15 accent-white" : "bg-black/10 accent-black")}
      />
    </label>
  )
}

// Small square buttons: the theme toggle, curtain count and seed.
const Toggle = ({ on, onClick, label, children, dark }: { on?: boolean; onClick: () => void; label: string; children: React.ReactNode; dark: boolean }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    aria-pressed={on}
    onClick={onClick}
    className={cn(
      "flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-[12px] font-semibold tabular-nums transition-colors",
      dark
        ? on
          ? "border-white/30 bg-white/15 text-white"
          : "border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/10 hover:text-white"
        : on
          ? "border-black/20 bg-black/10 text-black"
          : "border-black/10 bg-white/50 text-black/55 hover:bg-white hover:text-black",
    )}
  >
    {children}
  </button>
)

export default function AuroraPlayground() {
  const [preset, setPreset] = useState(MARS)
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [bands, setBands] = useState(LANDING_AURORA.bands)
  const [speed, setSpeed] = useState(LANDING_AURORA.speed)
  const [intensity, setIntensity] = useState(LANDING_AURORA.intensity)
  const [height, setHeight] = useState(LANDING_AURORA.height)
  const [spread, setSpread] = useState(LANDING_AURORA.spread)
  const [rays, setRays] = useState(LANDING_AURORA.rays)
  const [seed, setSeed] = useState(LANDING_AURORA.seed)
  const dark = theme === "dark"

  return (
    <Aurora
      colors={PRESETS[preset].colors}
      theme={theme}
      bands={bands}
      speed={speed}
      intensity={intensity}
      height={height}
      spread={spread}
      rays={rays}
      stars={false}
      seed={seed}
      className="flex min-h-screen w-full flex-col justify-end font-sans"
    >
      <div className="flex justify-center px-6 pb-8">
        <div
          className={cn(
            "flex flex-wrap items-end justify-center gap-5 rounded-2xl border px-5 py-4",
            dark ? "border-white/10 bg-[#07090f]/85" : "border-black/5 bg-white/85 shadow-[0_20px_40px_-24px_rgba(20,30,60,0.35)]",
          )}
        >
          <div className="flex w-[300px] flex-col gap-1.5">
            <Label value={PRESETS[preset].name} dark={dark}>
              Palette
            </Label>
            <div className="grid grid-cols-9 gap-1.5">
              {PRESETS.map((p, i) => (
                <button
                  key={p.name}
                  type="button"
                  title={p.name}
                  aria-label={p.name}
                  aria-pressed={i === preset}
                  onClick={() => setPreset(i)}
                  className={cn(
                    "size-7 rounded-full ring-offset-2 transition-[box-shadow,transform] hover:scale-110",
                    dark ? "ring-offset-[#0b1020]" : "ring-offset-white",
                    i === preset && (dark ? "ring-2 ring-white" : "ring-2 ring-black"),
                  )}
                  style={{ background: `linear-gradient(135deg, ${p.colors.join(", ")})` }}
                />
              ))}
            </div>
          </div>

          <Range label="Speed" value={speed} min={0} max={3} step={0.05} onChange={setSpeed} dark={dark} />
          <Range label="Intensity" value={intensity} min={0.2} max={2} step={0.05} onChange={setIntensity} dark={dark} />
          <Range label="Height" value={height} min={0.1} max={0.8} step={0.01} onChange={setHeight} dark={dark} />
          <Range label="Spread" value={spread} min={0} max={2} step={0.05} onChange={setSpread} dark={dark} />
          <Range label="Rays" value={rays} min={0} max={1} step={0.05} onChange={setRays} dark={dark} />

          <div className="flex flex-col gap-1.5">
            <Label dark={dark}>Curtains</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((n) => (
                <Toggle key={n} on={bands === n} onClick={() => setBands(n)} label={`${n} curtains`} dark={dark}>
                  {n}
                </Toggle>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label dark={dark}>Sky</Label>
            <div className="flex gap-1">
              <Toggle onClick={() => setTheme(dark ? "light" : "dark")} label={dark ? "Light theme" : "Dark theme"} dark={dark}>
                {dark ? <Sun size={14} /> : <Moon size={14} />}
              </Toggle>
              <Toggle onClick={() => setSeed(Math.round(Math.random() * 1000) / 10)} label="New pattern" dark={dark}>
                <Shuffle size={14} />
              </Toggle>
            </div>
          </div>
        </div>
      </div>
    </Aurora>
  )
}

/* ───────────────────────────── movable ───────────────────────────── */

export type AuroraSettings = typeof LANDING_AURORA

/* The landing panel, after DialKit: a flat gray card (#424242, a step up from
   the page's #262626), sliders as full-width rows that fill as they rise with
   a thin bar at the edge, sentence-case labels inside, mono values. */

const ROW = "relative h-9 overflow-hidden rounded-lg"
const ROW_LABEL = "pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] font-medium"
const ROW_VALUE = "pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[12.5px] tabular-nums"

/** The panel's colours on a dark page (#424242 card) and on a light one (white card). */
export const DIAL_TONES = {
  dark: {
    card: "border-white/[0.05] bg-[#424242] shadow-[0_4px_14px_rgba(0,0,0,0.18)]",
    title: "text-white",
    meta: "text-white/50",
    row: "bg-white/[0.05]",
    fill: "bg-white/[0.08] group-hover:bg-white/[0.11] group-active:bg-white/[0.14]",
    bar: "bg-white/90",
    label: "text-white/70",
    value: "text-white/60 group-hover:text-white",
    pill: "bg-white/[0.11]",
    on: "text-white",
    off: "text-white/50 hover:text-white/80",
    button: "text-white/70 hover:bg-white/[0.1] hover:text-white active:bg-white/[0.12]",
    swatchOn: "ring-offset-[#424242] ring-[1.5px] ring-white/90",
    swatchOff: "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]",
  },
  light: {
    card: "border-black/[0.06] bg-white shadow-[0_4px_14px_rgba(0,0,0,0.08)]",
    title: "text-[#171717]",
    meta: "text-black/45",
    row: "bg-black/[0.04]",
    fill: "bg-black/[0.07] group-hover:bg-black/[0.1] group-active:bg-black/[0.13]",
    bar: "bg-black/80",
    label: "text-black/65",
    value: "text-black/55 group-hover:text-black",
    pill: "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12)]",
    on: "text-[#171717]",
    off: "text-black/45 hover:text-black/75",
    button: "text-black/65 hover:bg-black/[0.07] hover:text-black active:bg-black/[0.1]",
    swatchOn: "ring-offset-white ring-[1.5px] ring-black/80",
    swatchOff: "shadow-[inset_0_0_0_1px_rgba(0,0,0,0.1)]",
  },
}
export type DialTone = (typeof DIAL_TONES)["dark"]

/**
 * A row you drag across (it's a native range underneath, so keys work too).
 * The bar at the fill's edge steps aside while it would cross the label or
 * the value.
 */
export function DialSlider({ label, value, min, max, step, onChange, tone = DIAL_TONES.dark }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; tone?: DialTone }) {
  const row = useRef<HTMLLabelElement>(null)
  const name = useRef<HTMLSpanElement>(null)
  const num = useRef<HTMLSpanElement>(null)
  const [clear, setClear] = useState(true)
  const pct = ((value - min) / (max - min)) * 100

  useLayoutEffect(() => {
    if (!row.current || !name.current || !num.current) return
    const x = Math.min(Math.max(6, (pct / 100) * row.current.offsetWidth - 6), row.current.offsetWidth - 9)
    setClear(x > name.current.offsetLeft + name.current.offsetWidth + 4 && x + 3 < num.current.offsetLeft - 4)
  }, [pct])

  return (
    <label ref={row} className={cn(ROW, tone.row, "group block cursor-ew-resize")}>
      <div className={cn("pointer-events-none absolute inset-y-0 left-0 transition-colors", tone.fill)} style={{ width: `${pct}%` }} />
      <div
        className={cn("pointer-events-none absolute top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full transition-opacity duration-150", tone.bar)}
        style={{ left: `clamp(6px, calc(${pct}% - 6px), calc(100% - 9px))`, opacity: clear ? 1 : 0 }}
      />
      <span ref={name} className={cn(ROW_LABEL, tone.label)}>
        {label}
      </span>
      <span ref={num} className={cn(ROW_VALUE, "transition-colors", tone.value)}>
        {value.toFixed(2)}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </label>
  )
}

/** A label, then a segmented control with a pill that slides to the choice. */
function DialSegmented({ label, options, value, onChange, tone = DIAL_TONES.dark }: { label: string; options: number[]; value: number; onChange: (v: number) => void; tone?: DialTone }) {
  const i = Math.max(0, options.indexOf(value))
  return (
    <div className="flex h-9 items-center justify-between pl-2.5">
      <span className={cn("text-[13px] font-medium", tone.label)}>{label}</span>
      <div className={cn("relative flex rounded-lg p-0.5", tone.row)}>
        <div
          className={cn("absolute top-0.5 bottom-0.5 left-0.5 w-8 rounded-md transition-transform duration-200", tone.pill)}
          style={{ transform: `translateX(${i * 32}px)`, transitionTimingFunction: "cubic-bezier(0.25, 1, 0.5, 1)" }}
        />
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={o === value}
            onClick={() => onChange(o)}
            className={cn("relative h-7 w-8 font-mono text-[12.5px] transition-colors", o === value ? tone.on : tone.off)}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Palette, then every slider, in a DialKit-style gray card. */
export function AuroraPanel({ value, onChange, className, light = false }: { value: AuroraSettings; onChange: (v: AuroraSettings) => void; className?: string; light?: boolean }) {
  const tone = light ? DIAL_TONES.light : DIAL_TONES.dark
  const preset = Math.max(0, PRESETS.findIndex((p) => p.colors.join() === value.colors.join()))
  const set = <K extends keyof AuroraSettings>(key: K) => (v: AuroraSettings[K]) => onChange({ ...value, [key]: v })

  return (
    <div className={cn("w-[280px] rounded-[6px] border p-3 font-sans", tone.card, className)}>
      <div className="flex items-baseline justify-between px-0.5">
        <span className={cn("text-[13px] font-medium", tone.title)}>Palette</span>
        <span className={cn("font-mono text-[12px]", tone.meta)}>{PRESETS[preset].name}</span>
      </div>
      <div className="mt-2.5 grid grid-cols-9 gap-[7px] px-0.5">
        {PRESETS.map((p, i) => (
          <button
            key={p.name}
            type="button"
            title={p.name}
            aria-label={p.name}
            aria-pressed={i === preset}
            onClick={() => set("colors")(p.colors)}
            className={cn(
              "aspect-square rounded-full ring-offset-2 transition-[box-shadow,transform] duration-150 hover:scale-110",
              i === preset ? tone.swatchOn : tone.swatchOff,
            )}
            style={{ background: `linear-gradient(135deg, ${p.colors.join(", ")})` }}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        <DialSlider tone={tone} label="Speed" value={value.speed} min={0} max={3} step={0.05} onChange={set("speed")} />
        <DialSlider tone={tone} label="Height" value={value.height} min={0.1} max={0.8} step={0.01} onChange={set("height")} />
        <DialSlider tone={tone} label="Intensity" value={value.intensity} min={0.2} max={2} step={0.05} onChange={set("intensity")} />
        <DialSlider tone={tone} label="Spread" value={value.spread} min={0} max={2} step={0.05} onChange={set("spread")} />
        <DialSlider tone={tone} label="Rays" value={value.rays} min={0} max={1} step={0.05} onChange={set("rays")} />
        <DialSegmented tone={tone} label="Curtains" options={[1, 2, 3, 4]} value={value.bands} onChange={set("bands")} />
        <button
          type="button"
          onClick={() => set("seed")(Math.round(Math.random() * 1000) / 10)}
          className={cn(ROW, tone.row, "flex w-full items-center justify-between px-2.5 text-[13px] font-medium transition-colors", tone.button)}
        >
          New pattern
          <Shuffle size={14} />
        </button>
      </div>
    </div>
  )
}

/**
 * The aurora for the landing: transparent, so the light glows straight onto
 * the page, with its panel at the bottom right.
 */
export function LandingAurora({ className, light = false }: { className?: string; light?: boolean }) {
  const [settings, setSettings] = useState(LANDING_AURORA)

  return (
    <div className={cn("relative", className)}>
      <Aurora {...settings} theme={light ? "light" : "dark"} stars={false} background={false} className="h-full w-full" />
      <AuroraPanel light={light} value={settings} onChange={setSettings} className="absolute right-5 bottom-5" />
    </div>
  )
}
