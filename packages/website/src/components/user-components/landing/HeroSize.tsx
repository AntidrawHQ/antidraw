/**
 * The essay landing's settings for its tuning panels: the typeface (landing/LandingFonts), the
 * hero's title and paragraph sizes (desktop; phones keep their own) and the navbar menus' style.
 */
import { cn } from "@/lib/utils"
import { Slider } from "../parts/ColumnGlow"
import { LANDING_FONTS, fontStack } from "./LandingFonts"
import { MENU_STYLES, type MenuStyle } from "./NavMenus"

export type HeroSize = { font: string; title: number; para: number; menu: MenuStyle }
export const HERO_SIZE: HeroSize = { font: "schibsted", title: 48, para: 24, menu: "mega" }

export function HeroSizeControls({ value, onChange }: { value: HeroSize; onChange: (v: HeroSize) => void }) {
  const current = LANDING_FONTS.find((f) => f.id === value.font) ?? LANDING_FONTS[0]
  return (
    <>
      <span className="flex justify-between text-[11px] font-medium tracking-[0.08em] text-neutral-500 uppercase">
        Type
        <span className="tracking-normal text-neutral-200 normal-case">{current.name}</span>
      </span>
      {/* Each name in its own face, so the list is the preview. */}
      <div className="grid grid-cols-2 gap-1.5">
        {LANDING_FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            title={f.note}
            onClick={() => onChange({ ...value, font: f.id })}
            className={cn("h-8 truncate rounded-md px-2 text-left text-[13.5px]", f.id === value.font ? "bg-white text-[#171717]" : "bg-white/[0.06] text-neutral-200 hover:bg-white/[0.1]")}
            style={{ fontFamily: fontStack(f.id) }}
          >
            {f.name}
          </button>
        ))}
      </div>
      <p className="m-0 text-[11.5px] leading-[1.45] text-neutral-500">{current.note}</p>
      <Slider label="Title" min={40} max={120} step={1} value={value.title} onChange={(title) => onChange({ ...value, title })} />
      <Slider label="Paragraph" min={18} max={40} step={1} value={value.para} onChange={(para) => onChange({ ...value, para })} />
      <span className="mt-2 text-[11px] font-medium tracking-[0.08em] text-neutral-500 uppercase">Navbar menu</span>
      <div className="flex flex-wrap gap-1.5">
        {MENU_STYLES.map((m) => (
          <button
            key={m.id}
            type="button"
            title={m.note}
            onClick={() => onChange({ ...value, menu: m.id })}
            className={cn("h-7 rounded-md px-2 text-[12px] font-medium", m.id === value.menu ? "bg-white text-[#171717]" : "bg-white/[0.06] text-neutral-300 hover:bg-white/[0.1]")}
          >
            {m.name}
          </button>
        ))}
      </div>
    </>
  )
}
