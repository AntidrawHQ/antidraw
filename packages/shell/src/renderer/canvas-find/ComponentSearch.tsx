/**
 * ⌘F component search: the card. As designed in the Antidraw workspace's
 * ComponentSearchCard frame; CanvasFind puts it on the canvas.
 *
 * WHERE IT GOES
 *   Floats over the canvas, top right, 12px in from the canvas's edges. The
 *   canvas is not dimmed, and nothing on it is highlighted or selected.
 *
 * BEHAVIOUR
 *   ⌘F / Ctrl+F    opens it with the field focused and its text selected
 *                  (reopening keeps the last query, like browser find).
 *   typing         lists the matches, the first highlighted.
 *   ↓ / ↑          moves the highlight (wraps); the canvas stays put.
 *   ↵              goes to the highlighted match.
 *   click a row    goes to that match.
 *   Esc / ×        closes; the camera stays where it is.
 *   "Goes to" = what clicking a row in the Components tab does: the camera
 *   frames it (here at once, not flying), selecting nothing. With no query,
 *   or no matches, only the field shows. The focus stays in the field
 *   throughout, so its keys stay its own.
 *
 * MATCHING
 *   Case-insensitive, spaces ignored (in the query and the name). A
 *   substring match first; otherwise the
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
 *            (same as the dashboard's search field)
 *   divider  0.5px #373737
 *   list     4px padding, max 232px tall, then scrolls
 *   row      px 10 / py 6, 6px radius, 8px gap, 13px · lucide Blocks 14px
 *            (the dashboard's menu item)
 *            idle icon #a3a3a3 · hover bg white/3% ·
 *            current bg white/6%, icon #e0e0e0
 *   font     Geist
 */
import { Blocks, Search, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

const SHADOW = ["0 0 0 0.5px #373737", ...[1, 2, 4, 8, 16].map((d) => `0 ${d}px ${d * 2}px rgba(0,0,0,0.06)`)].join(", ")

/* ── Matching ─────────────────────────────────────────────────────────── */

type Hit = { name: string; idx: number[]; substring: boolean }

// A letter lowercased, kept to one code point so the indices stay the name's:
// "İ" lowercases to "i" and a combining dot, and is matched as "i".
const lower = (ch: string) => [...ch.toLowerCase()][0]!

// Indices are into [...name] (code points, as Name draws it), spaces skipped
// on both sides, so "hero section" is a substring of "Hero Section".
function match(q: string, name: string): { idx: number[]; substring: boolean } | null {
  const s = [...q].filter((ch) => !/\s/.test(ch)).map(lower)
  if (!s.length) return { idx: [], substring: true }
  const at: number[] = []
  const n: string[] = []
  ;[...name].forEach((ch, i) => {
    if (/\s/.test(ch)) return
    at.push(i)
    n.push(lower(ch))
  })
  for (let start = 0; start + s.length <= n.length; start++) {
    if (s.every((ch, k) => n[start + k] === ch)) return { idx: s.map((_, k) => at[start + k]!), substring: true }
  }
  const idx: number[] = []
  for (let i = 0, j = 0; i < n.length && j < s.length; i++) if (n[i] === s[j]) idx.push(at[i]!), j++
  return idx.length === s.length ? { idx, substring: false } : null
}

function search(q: string, names: string[]): Hit[] {
  if (!q.trim()) return []
  const hits = names.flatMap((name) => {
    const m = match(q, name)
    return m ? [{ name, ...m }] : []
  })
  return hits.sort((a, b) => Number(b.substring) - Number(a.substring) || a.idx[0]! - b.idx[0]!)
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
  /** Go to this component (frame it, as a Components tab row does). */
  onGoTo?: (name: string) => void
  onClose?: () => void
}) {
  const [q, setQ] = useState(initialQuery)
  // The highlighted match, by name: ↓ / ↑ move it, ↵ goes to it. By name so
  // it stays on the same component while the list changes under it (a frame
  // added or deleted); the first match when it's gone, or after typing.
  const [curName, setCurName] = useState<string | null>(null)
  const hits = useMemo(() => search(q, components), [q, components])
  const cur = Math.max(0, hits.findIndex((h) => h.name === curName))
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  const move = (i: number) => {
    if (hits.length) setCurName(hits[(i + hits.length) % hits.length]!.name)
  }
  const go = (i: number) => {
    const hit = hits[i]
    if (!hit) return
    setCurName(hit.name)
    onGoTo?.(hit.name)
  }

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${cur}"]`)?.scrollIntoView({ block: "nearest" })
  }, [cur, hits])

  const onKey = (e: React.KeyboardEvent) => {
    // An IME's keys (Enter commits the composition, arrows pick a candidate).
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      move(cur + (e.key === "ArrowDown" ? 1 : -1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      go(cur)
    } else if (e.key === "Tab") {
      // The focus stays in the field: on × or a row, Backspace and Esc would
      // be the canvas's (deleting the selected frames).
      e.preventDefault()
    } else if (e.key === "Escape" && !e.defaultPrevented) {
      // Not when a popover already took it (it closes first).
      e.preventDefault()
      onClose?.()
    }
  }

  return (
    <div
      className="w-[280px] overflow-hidden rounded-[10px] bg-[#2c2c2c]"
      style={{ boxShadow: SHADOW }}
      // A press on a row, ×, or the card around them leaves the focus in the
      // field (and Tab does, and they're out of the tab order): a focused row
      // would hand Esc, Backspace and letters to the canvas.
      onMouseDown={(e) => {
        if (e.target !== input.current) e.preventDefault()
      }}
    >
      <div className="flex h-[32px] items-center gap-2 pr-1 pl-2.5">
        <Search className="size-3.5 shrink-0 text-[#a3a3a3]" />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setCurName(null)
          }}
          onKeyDown={onKey}
          placeholder="Find a component"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[#e0e0e0] outline-none placeholder:text-[#a3a3a3]"
        />
        <button
          aria-label="Close"
          tabIndex={-1}
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
                  tabIndex={-1}
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

