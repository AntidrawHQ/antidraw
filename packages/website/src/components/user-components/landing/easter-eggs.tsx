/**
 * Easter eggs for a piece of the page that looks clickable but isn't (FooterWordmark's): clicking a part
 * marked `data-egg="<key>"` gets a reply, a small bubble where you clicked, from an Antidraw agent in the
 * canvas's comment style. Each part has a few lines that take turns as you keep clicking; when they run
 * out, the agent points at the real canvas. A click on a `button` inside a part gets the `toolbar` lines.
 * Nothing renders until the first click, so the server's HTML and the first client render agree.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from "react"

import { AgentIcon } from "../motion/canvas-ai/kit"

const VIOLET = "#7c5cff"
/** How long a bubble stays, in ms. */
const STAY = 3600
/** The bubble's width. */
const W = 236
/** Every tenth click, whatever was clicked, gets this instead. */
const TENTH_AT = 10

export type Eggs = { lines: Record<string, string[]>; out: string; tenth: string }

type Bubble = { id: number; x: number; y: number; text: string }

/** Pass `onClick` to the container (which must be `relative`); render `bubble` inside it. */
export function useEasterEggs(container: RefObject<HTMLElement | null>, eggs: Eggs) {
  const [popup, setPopup] = useState<Bubble | null>(null)
  const told = useRef(new Map<string, number>())
  const clicks = useRef(0)

  useEffect(() => {
    if (!popup) return
    const timer = window.setTimeout(() => setPopup(null), STAY)
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPopup(null)
    window.addEventListener("keydown", onKey)
    return () => {
      clearTimeout(timer)
      window.removeEventListener("keydown", onKey)
    }
  }, [popup])

  const onClick = useCallback(
    (e: MouseEvent) => {
      const target = e.target as Element
      const part = target.closest<HTMLElement>("[data-egg]")
      const box = container.current?.getBoundingClientRect()
      if (!part || !box) return setPopup(null)
      const key = target.closest("button") ? "toolbar" : part.dataset.egg!
      const lines = eggs.lines[key]
      if (!lines) return

      clicks.current += 1
      const n = told.current.get(key) ?? 0
      told.current.set(key, n + 1)
      // Its lines in turn, then the sign-off, then round again.
      const i = n % (lines.length + 1)
      const text = clicks.current % TENTH_AT === 0 ? eggs.tenth : i === lines.length ? eggs.out : lines[i]

      // Beside the pointer, kept inside the container.
      const x = Math.min(Math.max(12, e.clientX - box.left + 14), box.width - W - 12)
      const y = Math.min(Math.max(12, e.clientY - box.top + 14), box.height - 96)
      setPopup((p) => ({ id: (p?.id ?? 0) + 1, x, y, text }))
    },
    [container, eggs],
  )

  const bubble = popup && (
    <div
      key={popup.id}
      role="status"
      className="pointer-events-none absolute z-30 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:slide-in-from-top-1 motion-safe:duration-200"
      style={{ left: popup.x, top: popup.y, width: W }}
    >
      <div className="rounded-[10px] bg-[#2b2b2b] px-3 py-2 text-left font-sans shadow-[0_10px_30px_-8px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.08]">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: VIOLET }}>
          <AgentIcon size={12} />
          Antidraw
        </div>
        <div className="text-[12.5px] leading-[1.4] text-white/90">{popup.text}</div>
      </div>
    </div>
  )

  return { onClick, bubble }
}
