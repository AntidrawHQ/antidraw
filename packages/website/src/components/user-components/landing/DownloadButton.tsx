/**
 * The download button: Apple Silicon by default, with a menu for the Intel build beside it.
 *
 * Both links are GitHub's releases/latest/download/<file>, which always serve the newest release's file.
 * They rely on the DMGs carrying no version in their names (electron-builder.yml's dmg.artifactName).
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

const LATEST = "https://github.com/AntidrawHQ/antidraw/releases/latest/download"
export const DOWNLOADS = {
  silicon: `${LATEST}/Antidraw-arm64.dmg`,
  intel: `${LATEST}/Antidraw-x64.dmg`,
}

const TONE = {
  dark: {
    solid: "bg-white text-[#171717]",
    chip: "bg-black/[0.07] text-black/55",
    menu: "bg-[#2a2a2a] text-white ring-1 ring-white/10 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]",
    item: "hover:bg-white/[0.06] focus-visible:bg-white/[0.06]",
    note: "text-white/45",
  },
  light: {
    solid: "bg-[#171717] text-white",
    chip: "bg-white/[0.14] text-white/70",
    menu: "bg-white text-[#171717] ring-1 ring-black/10 shadow-[0_12px_32px_-14px_rgba(0,0,0,0.22)]",
    item: "hover:bg-black/[0.04] focus-visible:bg-black/[0.04]",
    note: "text-black/45",
  },
}

/**
 * "Download", with chips saying which Macs it's for and that it's an alpha; `icon` sits before the label. `stretch` fills the row,
 * as the hero's stacked buttons do on a phone. The menu hangs under the button's right edge.
 */
export function DownloadButton({ theme, icon, stretch = false, className }: { theme: "dark" | "light"; icon?: ReactNode; stretch?: boolean; className?: string }) {
  const t = TONE[theme]
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Closes on a press outside it, or on Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={cn("relative", stretch ? "flex" : "inline-flex", className)}>
      <div className={cn("flex h-11 items-stretch text-[15px] font-medium", stretch && "flex-1", t.solid)}>
        <a href={DOWNLOADS.silicon} className={cn("inline-flex items-center justify-center gap-2 whitespace-nowrap transition-transform active:scale-[0.97]", stretch ? "flex-1" : "pr-4 pl-5")}>
          {icon}
          Download
          <span className="ml-0.5 flex items-center gap-1">
            <span className={cn("rounded-[5px] px-1.5 py-[3px] text-[11px] leading-none font-medium tracking-[0.02em]", t.chip)}>Apple Silicon</span>
            <span className={cn("rounded-[5px] px-1.5 py-[3px] text-[11px] leading-none font-medium tracking-[0.02em]", t.chip)}>Alpha</span>
          </span>
        </a>
        <span aria-hidden className="my-3 w-px bg-current opacity-20" />
        <button
          type="button"
          aria-label="More downloads"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="grid w-10 place-items-center"
        >
          <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div role="menu" className={cn("absolute top-full right-0 z-50 mt-1.5 min-w-[220px] p-1 text-left", t.menu)}>
          <a role="menuitem" href={DOWNLOADS.intel} onClick={() => setOpen(false)} className={cn("flex flex-col gap-0.5 px-3 py-2 outline-none", t.item)}>
            <span className="text-[14px] font-medium">Download for Intel Mac</span>
            <span className={cn("text-[12px]", t.note)}>For Macs with an Intel processor</span>
          </a>
        </div>
      )}
    </div>
  )
}
