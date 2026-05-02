import { Component, useEffect, useRef, useState } from "react"
import type { ComponentType, ReactNode } from "react"
import { useSearch } from "@tanstack/react-router"

class RenderErrorBoundary extends Component<
  { children: ReactNode; componentName: string },
  { error: Error | null }
> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <Message tone="error">
          &quot;{this.props.componentName}&quot; crashed:{" "}
          {this.state.error.message}
        </Message>
      )
    }
    return this.props.children
  }
}

const Message = ({
  tone,
  children,
}: {
  tone: "muted" | "error"
  children: ReactNode
}) => (
  <div
    className={`flex items-center justify-center h-screen ${
      tone === "error" ? "text-red-400" : "text-neutral-400"
    }`}
  >
    <h1 className="text-xl">{children}</h1>
  </div>
)

const FullscreenFrame = ({
  componentName,
  children,
}: {
  componentName: string
  children: ReactNode
}) => {
  useEffect(() => {
    document.title = componentName
  }, [componentName])

  return (
    <div className="w-screen h-screen flex items-center justify-center">
      {children}
    </div>
  )
}

const EmbeddedFrame = ({
  componentName,
  children,
}: {
  componentName: string
  children: ReactNode
}) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
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
  }, [componentName])

  return (
    <div ref={containerRef} className="inline-block">
      {children}
    </div>
  )
}

export const Preview = () => {
  const { componentName, fullscreen } = useSearch({ from: "/preview" })

  const [LoadedComponent, setLoadedComponent] =
    useState<ComponentType | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (!componentName) return
    let cancelled = false
    setLoadError(null)
    setLoadedComponent(null)
    import(
      /* @vite-ignore */ `/src/components/user-components/${componentName}.tsx`
    )
      .then((m) => {
        if (cancelled) return
        if (typeof m.default !== "function") {
          setLoadError(`No default export from ${componentName}.tsx`)
          return
        }
        setLoadedComponent(() => m.default as ComponentType)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const message =
          e instanceof Error ? e.message : "Failed to load component"
        setLoadError(message)
      })
    return () => {
      cancelled = true
    }
  }, [componentName, retryTick])

  // While in the load-error state, treat any HMR tick as a chance to retry —
  // React.lazy used to cache rejected imports forever; we don't.
  // Gated on loadError so working components keep Fast Refresh state.
  useEffect(() => {
    if (!loadError || !import.meta.hot) return
    const onUpdate = () => setRetryTick((t) => t + 1)
    import.meta.hot.on("vite:beforeUpdate", onUpdate)
    return () => {
      import.meta.hot?.off("vite:beforeUpdate", onUpdate)
    }
  }, [loadError])

  if (!componentName) {
    return <Message tone="muted">No component selected for preview</Message>
  }
  if (loadError) {
    return (
      <Message tone="error">
        Couldn&apos;t load &quot;{componentName}&quot;: {loadError}
      </Message>
    )
  }
  if (!LoadedComponent) return null

  return (
    <RenderErrorBoundary key={componentName} componentName={componentName}>
      {fullscreen ? (
        <FullscreenFrame componentName={componentName}>
          <LoadedComponent />
        </FullscreenFrame>
      ) : (
        <EmbeddedFrame componentName={componentName}>
          <LoadedComponent />
        </EmbeddedFrame>
      )}
    </RenderErrorBoundary>
  )
}

export default Preview
