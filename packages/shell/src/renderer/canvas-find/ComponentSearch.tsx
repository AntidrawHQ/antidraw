/**
 * ⌘F component search: the card. As designed in the Antidraw workspace's
 * ComponentSearchCard frame; CanvasFind puts it on the canvas.
 *
 * WHERE IT GOES
 *   Floats over the canvas, top right, 12px in from the canvas's edges. The
 *   canvas is not dimmed and nothing on it is highlighted except the normal
 *   selection of the component landed on.
 *
 * BEHAVIOUR
 *   ⌘F / Ctrl+F    opens it with the field focused and its text selected
 *                  (reopening keeps the last query, like browser find).
 *   typing         lists the matches, the first highlighted.
 *   ↓ / ↑          moves the highlight (wraps); the canvas stays put.
 *   ↵              goes to the highlighted match.
 *   click a row    goes to that match.
 *   Esc / ×        closes; you stay on the component you landed on.
 *   "Goes to" = what clicking a row in the Components tab does: the camera
 *   frames it (here at once, not flying). With no query, or no matches, only
 *   the field shows.
 *
 * MATCHING
 *   Case-insensitive, spaces ignored. A substring match first; otherwise the
 *   letters in order ("chf" → CheckoutForm). Substring matches rank first,
 *   then by where the match starts. Matched letters are #f5f5f5, the rest of
 *   the name #a3a3a3.
 *
 * SPEC
 *   card     280px wide, 10px radius, #2c2c2c
 *            border: 0.5px #373737 (box-shadow spread, the dashboard menus' colour)
 *            shadow: 5 layers, 0 {1,2,4,8,16}px {2,4,8,16,32}px rgba(0,0,0,.06)
 *   field    32px tall, 10px left / 4px right padding, 8px gap
 *            search icon 14px #a3a3a3 · text 13px #e0e0e0 · placeholder #a3a3a3
 *            close: 24px button, 6px radius, 12px icon #a3a3a3,
 *                   hover #373737 bg / #e0e0e0 icon
 *            (same as the dashboard's search field, Header.tsx:27)
 *   divider  0.5px #373737
 *   list     4px padding, max 232px tall, then scrolls
 *   row      px 10 / py 6, 6px radius, 8px gap, 13px · lucide Blocks 14px
 *            (the dashboard's menu item, kit.tsx:148)
 *            idle icon #a3a3a3 · hover bg white/3% ·
 *            current bg white/6%, icon #e0e0e0
 *   font     Geist
 */
import { Blocks, Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

const SHADOW = ["0 0 0 0.5px #373737", ...[1, 2, 4, 8, 16].map((d) => `0 ${d}px ${d * 2}px rgba(0,0,0,0.06)`)].join(", ")

/* ── Matching ─────────────────────────────────────────────────────────── */

type Hit = { name: string; idx: number[] }

function match(q: string, name: string): number[] | null {
  const s = q.toLowerCase().replace(/\s+/g, "")
  if (!s) return []
  const n = name.toLowerCase()
  const at = n.indexOf(s)
  if (at >= 0) return Array.from({ length: s.length }, (_, i) => at + i)
  const idx: number[] = []
  for (let i = 0, j = 0; i < n.length && j < s.length; i++) if (n[i] === s[j]) idx.push(i), j++
  return idx.length === s.length ? idx : null
}

function search(q: string, names: string[]): Hit[] {
  if (!q.trim()) return []
  const hits = names.flatMap((name) => {
    const idx = match(q, name)
    return idx ? [{ name, idx }] : []
  })
  const score = ({ idx }: Hit) => (idx[idx.length - 1]! - idx[0]! + 1 === idx.length ? 0 : 100) + idx[0]!
  return hits.sort((a, b) => score(a) - score(b))
}

function Name({ text, idx }: { text: string; idx: number[] }) {
  const set = new Set(idx)
  const runs: { s: string; on: boolean }[] = []
  ;[...text].forEach((ch, i) => {
    const on = set.has(i)
    const last = runs[runs.length - 1]
    if (last && last.on === on) last.s += ch
    else runs.push({ s: ch, on })
  })
  return (
    <>
      {runs.map((r, i) => (
        <span key={i} className={r.on ? "text-[#f5f5f5]" : "text-[#a3a3a3]"}>
          {r.s}
        </span>
      ))}
    </>
  )
}

/* ── The card ─────────────────────────────────────────────────────────── */

export function ComponentSearch({
  components,
  initialQuery = "",
  onGoTo,
  onClose,
}: {
  /** Names of the components on the canvas. */
  components: string[]
  initialQuery?: string
  /** Fly to and select this component (what a Components tab row does). */
  onGoTo?: (name: string) => void
  onClose?: () => void
}) {
  const [q, setQ] = useState(initialQuery)
  // The highlighted match: ↓ / ↑ move it, ↵ goes to it.
  const [cur, setCur] = useState(0)
  const hits = useMemo(() => search(q, components), [q, components])
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const move = (i: number) => {
    if (hits.length) setCur((i + hits.length) % hits.length)
  }
  const go = (i: number) => {
    const hit = hits[i]
    if (!hit) return
    setCur(i)
    onGoTo?.(hit.name)
  }

  useEffect(() => input.current?.select(), [])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${cur}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cur])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      move(cur + (e.key === "ArrowDown" ? 1 : -1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      go(cur)
    } else if (e.key === "Escape") onClose?.()
  }

  return (
    <div className="w-[280px] overflow-hidden rounded-[10px] bg-[#2c2c2c]" style={{ boxShadow: SHADOW }}>
      <div className="flex h-[32px] items-center gap-2 pr-1 pl-2.5">
        <Search className="size-3.5 shrink-0 text-[#a3a3a3]" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setCur(0)
          }}
          onKeyDown={onKey}
          placeholder="Find a component"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[#e0e0e0] outline-none placeholder:text-[#a3a3a3]"
        />
        <button
          aria-label="Close"
          onClick={onClose}
          className="grid size-[24px] shrink-0 place-items-center rounded-[6px] text-[#a3a3a3] hover:bg-[#373737] hover:text-[#e0e0e0]"
        >
          <X className="size-3" strokeWidth={1.8} />
        </button>
      </div>

      {hits.length > 0 && (
        <>
          <div className="h-[0.5px] bg-[#373737]" />
          <div ref={list} className="max-h-[232px] overflow-y-auto p-1">
            {hits.map((h, i) => {
              const on = i === cur
              return (
                <button
                  key={h.name}
                  data-i={i}
                  onClick={() => go(i)}
                  className={`flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[13px] ${on ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"}`}
                >
                  <Blocks className={`size-3.5 shrink-0 ${on ? "text-[#e0e0e0]" : "text-[#a3a3a3]"}`} />
                  <span className="min-w-0 flex-1 truncate">
                    <Name text={h.name} idx={h.idx} />
                  </span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

