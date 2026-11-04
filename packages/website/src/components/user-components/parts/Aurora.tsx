/**
 * Aurora — a slow, living aurora background seeded from your brand colours.
 *
 * One WebGL fragment shader draws up to four curtains of light. Each curtain
 * has the shape of a real aurora: a bright, crisp lower hem that fades slowly
 * upward, combed into vertical rays that drift sideways. Colours add in
 * linear light and go through a soft tone curve, so overlaps glow instead of
 * turning muddy. On light backgrounds the same light becomes a tinted wash.
 *
 * It's soft by nature, so it renders at half a pixel per CSS pixel (whatever
 * the screen's density) and lets the browser scale it up, redraws at 30fps
 * (it drifts slowly enough that more is wasted work), pauses when it's
 * off-screen or the tab is hidden, and holds a still frame for people who
 * prefer reduced motion.
 *
 *   <Aurora colors={["#2bf39b", "#1fb6ff", "#7a5cff"]} className="h-[520px]">
 *     <Hero />
 *   </Aurora>
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { Moon, Sun } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

/* ───────────────────────────── helpers ───────────────────────────── */

type Theme = "auto" | "light" | "dark"

function useResolvedTheme(theme: Theme, ref: React.RefObject<HTMLElement | null>) {
  const [resolved, setResolved] = useState<"light" | "dark">("dark")
  useEffect(() => {
    if (theme !== "auto") {
      setResolved(theme)
      return
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const read = () => {
      const host = ref.current?.parentElement?.closest("[data-theme], .dark, .light")
      if (host) {
        const attr = host.getAttribute("data-theme")
        if (attr === "dark" || attr === "light") return setResolved(attr)
        return setResolved(host.classList.contains("dark") ? "dark" : "light")
      }
      setResolved(mq.matches ? "dark" : "light")
    }
    read()
    mq.addEventListener("change", read)
    const mo = new MutationObserver(read)
    mo.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ["class", "data-theme"] })
    return () => {
      mq.removeEventListener("change", read)
      mo.disconnect()
    }
  }, [theme, ref])
  return resolved
}

let colorCtx: CanvasRenderingContext2D | null = null
function parseColor(input: string): [number, number, number] {
  colorCtx ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true })
  if (!colorCtx) return [0.5, 0.5, 0.5]
  colorCtx.clearRect(0, 0, 1, 1)
  colorCtx.fillStyle = "#808080"
  colorCtx.fillStyle = input
  colorCtx.fillRect(0, 0, 1, 1)
  const d = colorCtx.getImageData(0, 0, 1, 1).data
  return [d[0] / 255, d[1] / 255, d[2] / 255]
}

/* ───────────────────────────── shader ───────────────────────────── */

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const FRAG = `
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uC0;
uniform vec3  uC1;
uniform vec3  uC2;
uniform vec3  uC3;
uniform float uNc;
uniform float uBands;
uniform float uIntensity;
uniform float uHeight;
uniform float uSpread;
uniform float uRays;
uniform float uStars;
uniform float uDark;
uniform float uSeed;
uniform float uScale;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * snoise(p); p = p * 2.03 + 17.13; a *= 0.5; }
  return s;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 pick(float i) {
  float k = mod(i, uNc);
  if (k < 0.5) return uC0;
  if (k < 1.5) return uC1;
  if (k < 2.5) return uC2;
  return uC3;
}
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / uRes;                 // y up
  float aspect = uRes.x / uRes.y;
  float x = uv.x * aspect;
  float t = uTime;

  vec3 acc = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float i = float(k);
    if (i >= uBands) break;
    float off = uSeed * 13.7 + i * 5.17;

    // Slow sideways drift of the whole curtain.
    float warp = fbm(vec2(x * 0.32 + off, t * 0.045 + off));
    float xx = x + warp * 0.85;

    // Hem line: where the curtain's bright lower edge sits.
    float base = uHeight + (i - (uBands - 1.0) * 0.5) * 0.075 * uSpread;
    float wave = fbm(vec2(xx * 0.85 + off * 0.3, t * (0.1 + i * 0.025))) * 0.17 * uSpread
               + sin(xx * 1.5 + t * 0.22 + off) * 0.035;
    float d = uv.y - (base + wave);

    // Crisp hem below, long luminous fade above.
    float fadeLen = 0.1 + 0.045 * i;
    float prof = d < 0.0 ? exp(-d * d / 0.0011) : exp(-d / fadeLen) * (0.75 + 0.25 * exp(-d * d / 0.002));

    // Vertical rays, combed by the same warp so they sway with the curtain.
    // Skipped outright when they're off: two noise lookups per curtain.
    float ray = 1.0;
    if (uRays > 0.001) {
      float r1 = snoise(vec2(xx * 13.0 + warp * 5.0, t * 0.32 + off));
      float r2 = snoise(vec2(xx * 37.0 + off, t * 0.55 - off));
      ray = clamp(0.55 + 0.5 * (r1 * 0.7 + r2 * 0.3), 0.0, 1.2);
      ray = mix(1.0, ray * ray * 1.35, uRays);
    }

    // Brightness breathing along the curtain.
    float pulse = 0.45 + 0.55 * smoothstep(-0.6, 0.8, snoise(vec2(xx * 0.55 - t * 0.07, off * 1.3)));

    // Top of each curtain shifts toward the next colour, like real oxygen/nitrogen layers.
    vec3 c = mix(toLin(pick(i)), toLin(pick(i + 1.0)), smoothstep(0.0, 0.4, d) * 0.65);
    acc += c * prof * ray * pulse;
  }

  // Keep the upper sky dark so content placed there stays legible.
  acc *= smoothstep(1.02, uHeight + 0.12, uv.y) * 0.85 + 0.15;
  acc *= uIntensity * 1.15;
  vec3 col = 1.0 - exp(-acc * 1.5);      // soft shoulder, never clips to white mush
  col = pow(col, vec3(1.0 / 2.2));
  float glow = max(col.r, max(col.g, col.b));

  float n = (hash(frag + fract(t) * 91.7) - 0.5) / 255.0 * 2.0;

  if (uDark > 0.5) {
    // Stars sit behind the light and thin out toward the horizon.
    float st = 0.0;
    if (uStars > 0.0) {
      float cell = 26.0 * uScale;
      vec2 id = floor(frag / cell);
      float h = hash(id + uSeed);
      if (h > 0.9) {
        vec2 sp = (id + vec2(hash(id + 3.1), hash(id + 7.7))) * cell;
        float dd = length(frag - sp) / uScale;
        float tw = 0.55 + 0.45 * sin(t * (1.0 + h * 3.0) + h * 40.0);
        st = smoothstep(1.4, 0.0, dd) * tw * (h - 0.9) * 10.0;
        st *= smoothstep(0.05, 0.5, uv.y) * (1.0 - glow * 0.85) * uStars;
      }
    }
    vec3 rgb = col + st * 0.8 + n;
    float a = clamp(max(rgb.r, max(rgb.g, rgb.b)), 0.0, 1.0);
    gl_FragColor = vec4(min(rgb, vec3(a)), a);
  } else {
    // Light mode: the same light, as a tinted wash over paper.
    vec3 hue = col / max(glow, 1e-3);
    float l = dot(hue, vec3(0.299, 0.587, 0.114));
    hue = clamp(mix(vec3(l), hue, 1.15), 0.0, 1.0) * 0.94;
    float a = clamp(glow * 0.78 + n, 0.0, 1.0);
    gl_FragColor = vec4(hue * a, a);
  }
}
`

/* ───────────────────────────── component ───────────────────────────── */

export type AuroraProps = {
  /** One to four CSS colours. Curtains cycle through them. */
  colors?: string[]
  /** Number of curtains, 1–4. Defaults to max(3, colors.length). */
  bands?: number
  /** Animation speed multiplier. */
  speed?: number
  /** Overall brightness. */
  intensity?: number
  /** Where the hem sits, 0 (bottom) – 1 (top). */
  height?: number
  /** How far curtains wander vertically and spread apart. */
  spread?: number
  /** 0 = smooth veils, 1 = strongly combed rays. */
  rays?: number
  /** Twinkling stars behind the light (dark theme only). */
  stars?: boolean
  /** Changes the pattern while keeping the style. */
  seed?: number
  /** Pixels rendered per CSS pixel, capped at the screen's density. Lower is cheaper. */
  resolution?: number
  /** Redraws per second. */
  fps?: number
  theme?: Theme
  paused?: boolean
  /** Paint the sky colour behind the light. Turn off to sit on your own background. */
  background?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

export function Aurora({
  colors = ["#2bf39b", "#1fb6ff", "#7a5cff"],
  bands,
  speed = 1,
  intensity = 1,
  height = 0.42,
  spread = 1,
  rays = 0.7,
  stars = true,
  seed = 0,
  resolution = 0.5,
  fps = 30,
  theme = "auto",
  paused = false,
  background = true,
  className,
  style,
  children,
}: AuroraProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const resolved = useResolvedTheme(theme, rootRef)

  const settings = useRef({ colors, bands, speed, intensity, height, spread, rays, stars, seed, resolved, paused, fps })
  settings.current = { colors, bands, speed, intensity, height, spread, rays, stars, seed, resolved, paused, fps }

  useEffect(() => {
    const layer = layerRef.current
    const root = rootRef.current
    if (!layer || !root) return
    // A fresh canvas per mount: a context we lost on cleanup can't be reused.
    const canvas = document.createElement("canvas")
    canvas.className = "absolute inset-0 h-full w-full"
    layer.appendChild(canvas)
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false })
    if (!gl) {
      canvas.remove()
      return
    }

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        console.error("[Aurora] shader compile failed:", gl.getShaderInfoLog(sh))
      }
      return sh
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, "aPos")
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    const u = (name: string) => gl.getUniformLocation(prog, name)
    const U = {
      res: u("uRes"), time: u("uTime"),
      c: [u("uC0"), u("uC1"), u("uC2"), u("uC3")],
      nc: u("uNc"), bands: u("uBands"), intensity: u("uIntensity"), height: u("uHeight"),
      spread: u("uSpread"), rays: u("uRays"), stars: u("uStars"), dark: u("uDark"),
      seed: u("uSeed"), scale: u("uScale"),
    }

    let scale = 1
    const resize = () => {
      const r = root.getBoundingClientRect()
      scale = Math.min(window.devicePixelRatio || 1, resolution)
      canvas.width = Math.max(1, Math.round(r.width * scale))
      canvas.height = Math.max(1, Math.round(r.height * scale))
      gl.viewport(0, 0, canvas.width, canvas.height)
      draw()
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    let time = 20 + Math.random() * 40
    let last = 0
    let raf = 0
    let visible = true
    // Stars ease in/out instead of popping when the theme flips.
    let starMix = 0
    // Colours are parsed through a 2D canvas, so only when they change.
    let colorKey = ""
    let rgb: [number, number, number][] = []

    const draw = () => {
      const s = settings.current
      const list = (s.colors.length ? s.colors : ["#2bf39b"]).slice(0, 4)
      if (list.join() !== colorKey) {
        colorKey = list.join()
        rgb = list.map(parseColor)
      }
      for (let i = 0; i < 4; i++) gl.uniform3fv(U.c[i], rgb[i % rgb.length])
      const dark = s.resolved === "dark"
      starMix += ((dark && s.stars ? 1 : 0) - starMix) * 0.08
      gl.uniform2f(U.res, canvas.width, canvas.height)
      gl.uniform1f(U.time, time)
      gl.uniform1f(U.nc, rgb.length)
      gl.uniform1f(U.bands, Math.max(1, Math.min(4, s.bands ?? Math.max(3, rgb.length))))
      gl.uniform1f(U.intensity, s.intensity)
      gl.uniform1f(U.height, s.height)
      gl.uniform1f(U.spread, s.spread)
      gl.uniform1f(U.rays, s.rays)
      gl.uniform1f(U.stars, starMix)
      gl.uniform1f(U.dark, dark ? 1 : 0)
      gl.uniform1f(U.seed, s.seed)
      gl.uniform1f(U.scale, scale)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const s = settings.current
      // A little early still counts, so 30fps doesn't fall to 20 on a 60Hz screen.
      if (last && now - last < 1000 / s.fps - 4) return
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      if (!s.paused && !reduced.matches) time += dt * s.speed
      draw()
    }
    const start = () => {
      if (raf || !visible || document.hidden) return
      last = 0
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }

    const ro = new ResizeObserver(resize)
    ro.observe(root)
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (visible) start()
      else stop()
    })
    io.observe(root)
    const onVis = () => (document.hidden ? stop() : start())
    document.addEventListener("visibilitychange", onVis)

    resize()
    start()
    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener("visibilitychange", onVis)
      gl.getExtension("WEBGL_lose_context")?.loseContext()
      canvas.remove()
    }
  }, [resolution])

  const dark = resolved === "dark"
  const sky = dark
    ? "linear-gradient(180deg, #03050b 0%, #060a17 55%, #0b1326 100%)"
    : "linear-gradient(180deg, #fbfcfe 0%, #f5f7fb 60%, #eef1f7 100%)"

  return (
    <div
      ref={rootRef}
      className={cn("relative isolate overflow-hidden", className)}
      style={{ background: background ? sky : undefined, transition: "background 400ms ease", ...style }}
      data-aurora-theme={resolved}
    >
      <div ref={layerRef} aria-hidden className="pointer-events-none absolute inset-0 -z-10" />
      {children}
    </div>
  )
}

/* ───────────────────────────── demo ───────────────────────────── */

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

function Range({
  label,
  value,
  min,
  max,
  step,
  onChange,
  dark,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  dark: boolean
}) {
  return (
    <label className="flex w-[118px] flex-col gap-1.5">
      <span
        className={cn(
          "flex justify-between text-[10px] font-semibold tracking-[0.12em] uppercase",
          dark ? "text-white/45" : "text-black/40",
        )}
      >
        {label}
        <span className={cn("tabular-nums", dark ? "text-white/80" : "text-black/70")}>{value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          "h-1 w-full cursor-pointer appearance-none rounded-full",
          dark ? "bg-white/15 accent-white" : "bg-black/10 accent-black",
        )}
      />
    </label>
  )
}

export default function AuroraDemo() {
  const [preset, setPreset] = useState(0)
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [speed, setSpeed] = useState(1)
  const [intensity, setIntensity] = useState(1)
  const [height, setHeight] = useState(0.42)
  const [rays, setRays] = useState(0.7)
  const dark = theme === "dark"
  const colors = PRESETS[preset].colors

  return (
    <Aurora
      colors={colors}
      theme={theme}
      speed={speed}
      intensity={intensity}
      height={height}
      rays={rays}
      className="flex min-h-screen w-full flex-col font-sans"
    >
      <nav className="flex items-center justify-between px-8 py-6">
        <div className={cn("flex items-center gap-2 text-[15px] font-semibold tracking-tight", dark ? "text-white" : "text-[#0b1020]")}>
          <span
            className="size-5 rounded-full"
            style={{ background: `conic-gradient(from 180deg, ${colors.join(", ")}, ${colors[0]})` }}
          />
          Northlight
        </div>
        <div className={cn("hidden gap-7 text-[13px] sm:flex", dark ? "text-white/60" : "text-black/55")}>
          <span>Product</span>
          <span>Pricing</span>
          <span>Changelog</span>
        </div>
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={() => setTheme(dark ? "light" : "dark")}
          className={cn(
            "flex size-9 items-center justify-center rounded-full border backdrop-blur transition-colors",
            dark ? "border-white/15 bg-white/5 text-white hover:bg-white/10" : "border-black/10 bg-white/60 text-black hover:bg-white",
          )}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </nav>

      <section className="flex flex-1 flex-col items-center justify-start px-6 pt-[9vh] text-center">
        <span
          className={cn(
            "mb-6 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-[0.14em] uppercase backdrop-blur",
            dark ? "border-white/15 bg-white/5 text-white/70" : "border-black/10 bg-white/50 text-black/55",
          )}
        >
          Aurora · background
        </span>
        <h1
          className={cn(
            "max-w-[760px] text-[56px] leading-[1.02] font-semibold tracking-[-0.045em] sm:text-[68px]",
            dark ? "text-white" : "text-[#0b1020]",
          )}
        >
          The sky, as a background.
        </h1>
        <p className={cn("mt-5 max-w-[480px] text-[16px] leading-relaxed", dark ? "text-white/60" : "text-black/55")}>
          Curtains of light seeded from your brand colours. Calm by default, paused off-screen, and it never turns
          to mud.
        </p>
        <div className="mt-8 flex gap-3">
          <button
            type="button"
            className={cn(
              "h-11 rounded-full px-6 text-[14px] font-semibold transition-transform active:scale-[0.97]",
              dark ? "bg-white text-[#05070d]" : "bg-[#0b1020] text-white",
            )}
          >
            Start building
          </button>
          <button
            type="button"
            className={cn(
              "h-11 rounded-full border px-6 text-[14px] font-semibold backdrop-blur",
              dark ? "border-white/15 bg-white/5 text-white" : "border-black/10 bg-white/50 text-[#0b1020]",
            )}
          >
            Read the docs
          </button>
        </div>
      </section>

      <div className="flex justify-center px-6 pb-8">
        <div
          className={cn(
            "flex flex-wrap items-end justify-center gap-5 rounded-2xl border px-5 py-4 backdrop-blur-xl",
            dark ? "border-white/10 bg-black/30" : "border-black/5 bg-white/55 shadow-[0_20px_40px_-24px_rgba(20,30,60,0.35)]",
          )}
        >
          <div className="flex w-[300px] flex-col gap-1.5">
            <span
              className={cn(
                "flex justify-between text-[10px] font-semibold tracking-[0.12em] uppercase",
                dark ? "text-white/45" : "text-black/40",
              )}
            >
              Palette
              <span className={cn("normal-case tracking-normal", dark ? "text-white/80" : "text-black/70")}>
                {PRESETS[preset].name}
              </span>
            </span>
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
          <Range label="Rays" value={rays} min={0} max={1} step={0.05} onChange={setRays} dark={dark} />
        </div>
      </div>
    </Aurora>
  )
}
