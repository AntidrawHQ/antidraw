import { useEffect, useState } from "react"

// Written onto every JSX element by the runtime's jsx-source-tagging Vite
// plugin as "src/…/File.tsx:line:col"
const SOURCE_ATTR = "data-antidraw-source"

type SourceLocation = {
  filePath: string
  line: number
  column: number
}

type InspectTarget = {
  element: HTMLElement
  source: string
  location: SourceLocation
}

const parseSource = (source: string): SourceLocation | null => {
  const match = /^(.+):(\d+):(\d+)$/.exec(source)
  if (!match) return null
  return {
    filePath: match[1],
    line: Number(match[2]),
    column: Number(match[3]),
  }
}

const findTarget = (raw: EventTarget | null): InspectTarget | null => {
  if (!(raw instanceof Element)) return null
  const element = raw.closest<HTMLElement>(`[${SOURCE_ATTR}]`)
  if (!element) return null
  const source = element.getAttribute(SOURCE_ATTR) ?? ""
  const location = parseSource(source)
  if (!location) return null
  return { element, source, location }
}

const HighlightBox = ({
  target,
  color,
  label,
}: {
  target: InspectTarget
  color: string
  label?: string
}) => {
  const rect = target.element.getBoundingClientRect()
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 2147483646 }}>
      <div
        style={{
          position: "fixed",
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          border: `1.5px solid ${color}`,
          background: `color-mix(in srgb, ${color} 8%, transparent)`,
          borderRadius: 2,
        }}
      />
      {label && (
        <div
          style={{
            position: "fixed",
            left: Math.max(rect.left, 4),
            top: Math.max(rect.top - 24, 4),
            background: color,
            color: "#fff",
            font: "11px/1.6 ui-monospace, monospace",
            padding: "1px 6px",
            borderRadius: 4,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </div>
      )}
    </div>
  )
}

// Shell-driven element picker. The shell toggles it with a
// `set-inspect-mode` postMessage; a click on any tagged element posts
// `element-selected` back with the element's source location, so the shell
// can anchor a comment to file:line:col.
export const InspectOverlay = ({ componentName }: { componentName: string }) => {
  const [enabled, setEnabled] = useState(false)
  const [hovered, setHovered] = useState<InspectTarget | null>(null)
  const [selected, setSelected] = useState<InspectTarget | null>(null)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; enabled?: unknown }
      if (data?.type !== "set-inspect-mode") return
      setEnabled(data.enabled === true)
      setHovered(null)
      setSelected(null)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  useEffect(() => {
    if (!enabled) return

    const onPointerMove = (event: PointerEvent) => {
      setHovered(findTarget(event.target))
    }
    // Keep the previewed component inert while picking: no focus, no
    // navigation, no click handlers
    const blockInteraction = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const onClick = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      const target = findTarget(event.target)
      setSelected(target)
      if (!target) return
      const rect = target.element.getBoundingClientRect()
      window.parent.postMessage(
        {
          type: "element-selected",
          componentName,
          source: target.source,
          filePath: target.location.filePath,
          line: target.location.line,
          column: target.location.column,
          tag: target.element.tagName.toLowerCase(),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        },
        "*",
      )
    }

    const previousCursor = document.body.style.cursor
    document.body.style.cursor = "crosshair"
    document.addEventListener("pointermove", onPointerMove, true)
    document.addEventListener("pointerdown", blockInteraction, true)
    document.addEventListener("mousedown", blockInteraction, true)
    document.addEventListener("click", onClick, true)

    return () => {
      document.body.style.cursor = previousCursor
      document.removeEventListener("pointermove", onPointerMove, true)
      document.removeEventListener("pointerdown", blockInteraction, true)
      document.removeEventListener("mousedown", blockInteraction, true)
      document.removeEventListener("click", onClick, true)
    }
  }, [enabled, componentName])

  if (!enabled) return null

  const hoverIsSelected = hovered?.element === selected?.element

  return (
    <>
      {selected && (
        <HighlightBox
          target={selected}
          color="#8b5cf6"
          label={`${selected.element.tagName.toLowerCase()} — ${selected.location.filePath}:${selected.location.line}`}
        />
      )}
      {hovered && !hoverIsSelected && (
        <HighlightBox
          target={hovered}
          color="#3b82f6"
          label={`${hovered.element.tagName.toLowerCase()} — ${hovered.location.filePath}:${hovered.location.line}`}
        />
      )}
    </>
  )
}
