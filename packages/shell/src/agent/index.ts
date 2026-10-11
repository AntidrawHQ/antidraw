import { startInspector } from "./agent"
import { PREVIEW_ATTRIBUTE } from "./protocol"

// What main runs in each preview frame once its DOM is ready
// (main/frame-agent.ts): the agent, on the element the component is in. That
// element comes and goes (the component loads lazily, a failed one is
// mounted again), so the agent follows it, and has none while it's gone. A
// runtime from before the marker has the element the page's root holds stand
// in, as that runtime's own inspector had. The page's full-screen view
// (?fullscreen=true, the published share page's) has no agent.

declare global {
  interface Window {
    __antidrawAgent?: true
  }
}

const params = new URLSearchParams(location.search)
const componentName = params.get("componentName")

if (componentName && params.get("fullscreen") !== "true" && !window.__antidrawAgent) {
  window.__antidrawAgent = true
  let marked = false
  const containerNow = () => {
    const el = document.querySelector<HTMLElement>(`[${PREVIEW_ATTRIBUTE}]`)
    if (el) marked = true
    if (el || marked) return el
    const root = document.getElementById("root")
    const only = root?.children.length === 1 ? root.firstElementChild : null
    return only instanceof HTMLElement ? only : root
  }
  let container: HTMLElement | null = null
  let stop: (() => void) | null = null
  const follow = () => {
    const now = containerNow()
    if (now === container) return
    stop?.()
    container = now
    stop = now && startInspector(now, componentName)
  }
  follow()
  new MutationObserver(follow).observe(document.documentElement, { childList: true, subtree: true })
}
