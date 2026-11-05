/**
 * Pastel pieces for the canvas landing (AntidrawLandingCanvas): two websites and two posters, made
 * up for it, in soft peach, lilac, mint and sky.
 *
 *  - BloomSite    a flower shop's home page (960×600). `lilac` 0→1 moves its hero from peach to lilac.
 *  - OrbitSite    a notes app's home page (960×600), with a peek of the app.
 *  - StaticPoster a gig poster (360×480): SOFT STATIC, live at the Glasshouse.
 *  - PastelPoster a design-week poster (360×480): a grid of pastel shapes.
 */
import { ArrowRight, Search, ShoppingBag, Sparkles } from "lucide-react"

export const SITE_W = 960
export const SITE_H = 600
export const POSTER_W = 360
export const POSTER_H = 480

const mixHex = (a: string, b: string, p: number) => {
  const c = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const [x, y] = [c(a), c(b)]
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * p).toString(16).padStart(2, "0")).join("")}`
}

/* ── Bloom ───────────────────────────────────────────────────────────── */

const PLUM = "#3d1f3a"

/** Where Bloom's headline sits, in site px, for a comment pin. */
export const BLOOM_HEAD = { x: 64, y: 150 }

export function BloomSite({ lilac = 0 }: { lilac?: number }) {
  const hero = mixHex("#ffe4d6", "#e6dcff", lilac)
  const blob = mixHex("#ffb59e", "#b9a6ff", lilac)
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#fff8f3] font-sans" style={{ color: PLUM }}>
      <div className="flex h-16 items-center px-16 text-[14px]">
        <span className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.02em]">
          <span className="size-6 rounded-full" style={{ background: `conic-gradient(#ffb59e, #f9a8d4, #c4b5fd, #a7f3d0, #ffb59e)` }} />
          bloom
        </span>
        <span className="ml-14 flex gap-8 opacity-70">
          <span>Bouquets</span>
          <span>Plants</span>
          <span>Subscriptions</span>
          <span>Gifts</span>
        </span>
        <span className="ml-auto flex items-center gap-5 opacity-80">
          <Search className="size-4" />
          <ShoppingBag className="size-4" />
        </span>
      </div>
      <div className="mx-8 flex h-[330px] items-center overflow-hidden rounded-[28px] px-12" style={{ background: hero, transition: "background-color .4s" }}>
        <div className="w-[420px]">
          <div className="mb-4 inline-flex rounded-full bg-white/70 px-3 py-1 text-[12px] font-medium">Same-day in the city</div>
          <h2 className="text-[52px] leading-[1.02] font-semibold tracking-[-0.035em]">
            Flowers that
            <br />
            last the week.
          </h2>
          <p className="mt-4 text-[15px] leading-[1.5] opacity-70">Seasonal stems from small growers, wrapped by hand and at your door by six.</p>
          <span className="mt-6 inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14px] font-medium text-white" style={{ background: PLUM }}>
            Shop bouquets <ArrowRight className="size-4" />
          </span>
        </div>
        {/* The bouquet: soft circles in the season's colours. */}
        <div className="relative ml-auto h-full w-[380px]">
          <span className="absolute top-[40px] left-[90px] size-[220px] rounded-full" style={{ background: blob, transition: "background-color .4s" }} />
          <span className="absolute top-[30px] left-[40px] size-[120px] rounded-full bg-[#f9a8d4]" />
          <span className="absolute top-[120px] left-[210px] size-[130px] rounded-full bg-[#fde68a]" />
          <span className="absolute top-[190px] left-[70px] size-[110px] rounded-full bg-[#a7f3d0]" />
          <span className="absolute top-[70px] left-[250px] size-[70px] rounded-full bg-[#c4b5fd]" />
          <span className="absolute top-[250px] left-[200px] h-[90px] w-[10px] rounded-full bg-[#86b388]" />
        </div>
      </div>
      <div className="mx-8 mt-6 grid grid-cols-4 gap-4">
        {[
          ["Peony cloud", "$48", "#fbcfe8"],
          ["Sunday tulips", "$36", "#fde68a"],
          ["Lilac hour", "$52", "#ddd6fe"],
          ["Mint & eucalyptus", "$40", "#bbf7d0"],
        ].map(([name, price, c]) => (
          <div key={name} className="flex items-center gap-3 rounded-[18px] bg-white p-3 shadow-[0_6px_18px_-10px_rgba(61,31,58,0.25)]">
            <span className="size-14 rounded-[12px]" style={{ background: c }} />
            <span className="flex flex-col text-[13px]">
              <span className="font-medium">{name}</span>
              <span className="opacity-60">{price}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Orbit ───────────────────────────────────────────────────────────── */

export function OrbitSite() {
  return (
    <div className="absolute inset-0 overflow-hidden font-sans text-[#17233d]" style={{ background: "linear-gradient(160deg, #e0f2fe 0%, #ede9fe 55%, #fce7f3 100%)" }}>
      <div className="flex h-16 items-center px-16 text-[14px]">
        <span className="flex items-center gap-2 text-[20px] font-semibold tracking-[-0.02em]">
          <span className="grid size-6 place-items-center rounded-full border-2 border-[#17233d]">
            <span className="size-2 rounded-full bg-[#17233d]" />
          </span>
          orbit
        </span>
        <span className="ml-auto flex items-center gap-8 opacity-70">
          <span>Product</span>
          <span>Pricing</span>
          <span>Changelog</span>
        </span>
        <span className="ml-8 rounded-full bg-[#17233d] px-4 py-2 text-[13px] font-medium text-white">Get Orbit</span>
      </div>
      <div className="mt-10 text-center">
        <div className="mx-auto mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-[12px] font-medium">
          <Sparkles className="size-3.5 text-[#8b5cf6]" />
          Now with daily recaps
        </div>
        <h2 className="text-[48px] leading-[1.04] font-semibold tracking-[-0.035em]">Notes that keep you in orbit.</h2>
        <p className="mx-auto mt-3 max-w-[460px] text-[15px] leading-[1.5] opacity-65">Capture anything, find it in a second, and wake up to a recap of what matters.</p>
      </div>
      {/* A peek of the app. */}
      <div className="mx-auto mt-8 flex h-[300px] w-[760px] overflow-hidden rounded-t-[18px] bg-white shadow-[0_20px_50px_-20px_rgba(23,35,61,0.35)]">
        <div className="w-[180px] border-r border-[#eef0f6] bg-[#fafbff] p-4 text-[12.5px]">
          {["Today", "Ideas", "Reading", "Trips", "Recipes"].map((x, i) => (
            <div key={x} className="mb-1.5 flex items-center gap-2 rounded-[8px] px-2 py-1.5" style={{ background: i === 0 ? "#ede9fe" : undefined }}>
              <span className="size-2 rounded-full" style={{ background: ["#8b5cf6", "#f472b6", "#38bdf8", "#34d399", "#fbbf24"][i] }} />
              {x}
            </div>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-3 gap-3 p-5">
          {[
            ["Morning recap", "#ede9fe"],
            ["Trip to Lisbon", "#e0f2fe"],
            ["Book list", "#fce7f3"],
            ["Ideas for the shop", "#dcfce7"],
            ["Pasta, but quick", "#fef3c7"],
            ["Q4 planning", "#ede9fe"],
          ].map(([t, c]) => (
            <div key={t} className="rounded-[12px] p-3" style={{ background: c }}>
              <div className="text-[13px] font-medium">{t}</div>
              <div className="mt-2 h-1.5 w-4/5 rounded-full bg-black/[0.08]" />
              <div className="mt-1.5 h-1.5 w-3/5 rounded-full bg-black/[0.08]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── Posters ─────────────────────────────────────────────────────────── */

export function StaticPoster() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#d9ccff] p-7 font-sans text-[#2a1650]">
      <span className="absolute -top-10 -right-16 size-[300px] rounded-full" style={{ background: "radial-gradient(circle at 35% 35%, #ffd6e7, #ff9ec4 55%, #ffb38a)" }} />
      <span className="absolute top-[150px] left-[-60px] size-[200px] rounded-full bg-[#bdf0e0] mix-blend-multiply" />
      <div className="relative flex h-full flex-col">
        <span className="text-[12px] font-semibold tracking-[0.2em] uppercase">Live · Nov 14</span>
        <h3 className="mt-auto text-[78px] leading-[0.86] font-black tracking-[-0.05em]">
          SOFT
          <br />
          STATIC
        </h3>
        <div className="mt-5 flex items-end justify-between border-t-2 border-[#2a1650] pt-3 text-[12.5px] font-medium">
          <span>
            at the Glasshouse
            <br />
            doors 8pm
          </span>
          <span className="text-right">
            with Pale Moth
            <br />& Velvet Hours
          </span>
        </div>
      </div>
    </div>
  )
}

export function PastelPoster() {
  const shapes = ["#ffb5a7", "#fcd5ce", "#c3b1ff", "#a8e6cf", "#ffe29a", "#9ad7ff", "#ffc6ff", "#b8f2e6", "#ffd6a5"]
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#fffaf0] p-6 font-sans text-[#1f2937]">
      <div className="grid grid-cols-3 gap-2.5">
        {shapes.map((c, i) => (
          <span key={c} className="aspect-square" style={{ background: c, borderRadius: ["50%", "50% 50% 0 0", "0 50% 50% 50%", "18px", "50%", "0 0 50% 50%", "50% 0", "50%", "18px 50%"][i] }} />
        ))}
      </div>
      <div className="mt-5 text-[11px] font-semibold tracking-[0.2em] uppercase opacity-60">Design week · Lisbon</div>
      <h3 className="mt-1 text-[46px] leading-[0.92] font-black tracking-[-0.04em]">
        PASTEL
        <br />
        WEEK 26
      </h3>
    </div>
  )
}
