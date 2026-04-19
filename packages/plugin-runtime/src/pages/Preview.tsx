import { createElement, useEffect, useRef } from "react"
import { useSearch } from "@tanstack/react-router"
import { userComponents } from "@antidrawapp/user-components"

type ComponentMap = Record<string, React.ComponentType>

export const Preview = () => {
  const { componentName, fullscreen } = useSearch({ strict: false }) as { componentName?: string; fullscreen?: boolean }
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (fullscreen && componentName) {
      document.title = componentName
    }
  }, [fullscreen, componentName])

  useEffect(() => {
    if (containerRef.current && componentName && !fullscreen) {
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
  }, [componentName, fullscreen])

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
    <div
      ref={containerRef}
      className={fullscreen ? "w-screen h-screen flex items-center justify-center" : ""}
      style={fullscreen ? undefined : { display: "inline-block" }}
    >
      {createElement(Component)}
    </div>
  )
}

export default Preview
