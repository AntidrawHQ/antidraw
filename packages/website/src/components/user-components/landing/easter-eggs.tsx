/**
 * An easter egg for a piece of the page that looks clickable but isn't (FooterWordmark's): clicking a part
 * marked `data-egg` pops a small bubble up from where you clicked, in the canvas's comment style, with `text`.
 * It's placed against the window, not the container, so it can rise past the container's edge (the
 * footer's band clips its glow). Escape, a click elsewhere, a scroll, or a few seconds closes it. Nothing renders until the first click, so the
 * server's HTML and the first client render agree.
 */
import { useCallback, useEffect, useState, type MouseEvent } from "react"

/** How long a bubble stays, in ms. */
const STAY = 3600
/** The bubble's width, and the room it needs above the click (its height and a margin). */
const W = 260
const ROOM = 68

type Bubble = { id: number; x: number; y: number }

/** Pass `onClick` to the container; render `bubble` anywhere inside it. */
export function useEasterEgg(text: string) {
  const [popup, setPopup] = useState<Bubble | null>(null)

  useEffect(() => {
    if (!popup) return
    const timer = window.setTimeout(() => setPopup(null), STAY)
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPopup(null)
    const onScroll = () => setPopup(null)
    window.addEventListener("keydown", onKey)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("scroll", onScroll)
    }
  }, [popup])

  const onClick = useCallback(
    (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-egg]")) return setPopup(null)
      // Its bottom-left just above the pointer, kept inside the window.
      const x = Math.min(Math.max(12, e.clientX - 12), window.innerWidth - W - 12)
      const y = Math.max(ROOM, e.clientY - 10)
      setPopup((p) => ({ id: (p?.id ?? 0) + 1, x, y }))
    },
    [],
  )

  const bubble = popup && (
    <div
      key={popup.id}
      role="status"
      className="pointer-events-none fixed z-30 origin-bottom-left -translate-y-full motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:slide-in-from-bottom-2 motion-safe:duration-200"
      style={{ left: popup.x, top: popup.y, width: W }}
    >
      <div className="rounded-[10px] bg-[#2b2b2b] px-3 py-2 text-left font-sans text-[12.5px] leading-[1.4] text-white/90 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.08]">{text}</div>
    </div>
  )

  return { onClick, bubble }
}
