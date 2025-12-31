import { createElement, useEffect, useRef } from "react"
import { useSearch } from "@tanstack/react-router"
import { userComponents } from "@antidrawapp/user-components"

type ComponentMap = Record<string, React.ComponentType>

export const Preview = () => {
  const { componentName } = useSearch({ strict: false }) as { componentName?: string }
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current && componentName) {
      window.parent.postMessage(
        {
          type: "component-size",
          componentName,
          width: containerRef.current.scrollWidth,
          height: containerRef.current.scrollHeight,
        },
        "*"
      )
    }
  }, [componentName])

  if (!componentName) {
    return (
      <div className="flex items-center justify-center h-screen text-neutral-400">
        <h1 className="text-xl">No component selected for preview</h1>
      </div>
    )
  }

  const components = userComponents as ComponentMap

  if (!(componentName in components)) {
    return (
      <div className="flex items-center justify-center h-screen text-red-400">
        <h1 className="text-xl">Component &quot;{componentName}&quot; not found</h1>
      </div>
    )
  }

  const Component = components[componentName]

  return (
    <div ref={containerRef} style={{ display: "inline-block" }}>
      {createElement(Component)}
    </div>
  )
}

export default Preview
