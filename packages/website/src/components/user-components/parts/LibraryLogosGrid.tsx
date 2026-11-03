/**
 * LibraryLogosGrid — a logo wall in two groups, open source then companies: each library a cell
 * with its mark, name and maker, in full colour.
 */
import { cn } from "@/lib/utils"
import { BigMark, COMPANY_LIBS, OPEN_LIBS, type Lib } from "../libraries/catalog"

/** One group's grid of logos, no title: for placing under a section heading. */
/** The grid's hairlines and labels on a dark or a light page. */
const GRID_TONE = {
  dark: { line: "border-white/[0.06]", hover: "hover:bg-white/[0.03]", name: "text-white/80", maker: "text-white/35" },
  light: { line: "border-black/[0.07]", hover: "hover:bg-black/[0.025]", name: "text-black/80", maker: "text-black/40" },
}

/** `size` "lg" is the landing's: bigger marks and labels, taller cells. */
export function LogoGrid({ libs, className, theme = "dark", size = "md" }: { libs: Lib[]; className?: string; theme?: "dark" | "light"; size?: "md" | "lg" }) {
  const g = GRID_TONE[theme]
  const lg = size === "lg"
  return (
    <div className={className}>
      {/* Hairlines drawn by each cell (its right and bottom edges, the grid's top and left), so a short last row leaves no filled gap. */}
      <div className={cn("grid grid-cols-3 border-t border-l sm:grid-cols-4 lg:grid-cols-6", g.line)}>
        {libs.map((l) => (
          <div key={l.library + l.maker} className={cn("group flex flex-col items-center border-r border-b text-center transition-colors", !lg && "px-3", lg ? "gap-3 px-2 py-6 sm:gap-4 sm:px-3 sm:py-9" : "gap-3 py-6", g.line, g.hover)}>
            <BigMark mark={l.mark} size={lg ? 52 : 40} className="transition-transform duration-200 group-hover:scale-105" />
            <span className="flex flex-col gap-0.5">
              <span className={cn("font-medium", lg ? "text-[14px] sm:text-[16px]" : "text-[13px]", g.name)}>{l.library}</span>
              <span className={cn(lg ? "text-[12px] sm:text-[13.5px]" : "text-[11.5px]", g.maker)}>{l.maker}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Group({ title, libs }: { title: string; libs: Lib[] }) {
  return (
    <div>
      <p className="mb-4 text-[13px] text-white/40">{title}</p>
      <LogoGrid libs={libs} />
    </div>
  )
}

export function LibraryLogosGridSection({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-14 font-sans", className)}>
      <Group title="bring your favourite component library" libs={OPEN_LIBS} />
      <Group title="or your favourite company's" libs={COMPANY_LIBS} />
    </div>
  )
}

export default function LibraryLogosGrid() {
  return (
    <div className="min-h-screen bg-[#262626] px-8 py-16">
      <LibraryLogosGridSection className="mx-auto max-w-[1180px]" />
    </div>
  )
}
