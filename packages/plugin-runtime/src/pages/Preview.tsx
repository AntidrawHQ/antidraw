import { Component, Suspense, lazy, useEffect, useMemo, useRef } from "react"
import type { ReactNode } from "react"
import { useSearch } from "@tanstack/react-router"

class LoadErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

const Frame = ({
  componentName,
  fullscreen,
  children,
}: {
  componentName: string
  fullscreen: boolean
  children: ReactNode
}) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (fullscreen) {
      document.title = componentName
      return
    }
    if (!containerRef.current) return
    window.parent.postMessage(
      {
        type: "component-size",
        componentName,
        width: containerRef.current.scrollWidth,
        height: containerRef.current.scrollHeight,
      },
      "*",
    )
  }, [componentName, fullscreen])

  return (
    <div
      ref={containerRef}
      className={
        fullscreen
          ? "w-screen h-screen flex items-center justify-center"
          : "inline-block"
      }
    >
      {children}
    </div>
  )
}

export const Preview = () => {
  const { componentName, fullscreen } = useSearch({ strict: false }) as {
    componentName?: string
    fullscreen?: boolean
  }

  const LazyComponent = useMemo(() => {
    if (!componentName) return null
    return lazy(() =>
      import(
        /* @vite-ignore */ `/src/components/user-components/${componentName}.tsx`
      ),
    )
  }, [componentName])

  if (!componentName || !LazyComponent) {
    return (
      <div className="flex items-center justify-center h-screen text-neutral-400">
        <h1 className="text-xl">No component selected for preview</h1>
      </div>
    )
  }

  const notFound = (
    <div className="flex items-center justify-center h-screen text-red-400">
      <h1 className="text-xl">Component &quot;{componentName}&quot; not found</h1>
    </div>
  )

  return (
    <LoadErrorBoundary key={componentName} fallback={notFound}>
      <Suspense fallback={null}>
        <Frame componentName={componentName} fullscreen={!!fullscreen}>
          <LazyComponent />
        </Frame>
      </Suspense>
    </LoadErrorBoundary>
  )
}

export default Preview
