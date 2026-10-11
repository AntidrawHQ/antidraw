import { startInspector } from "./agent"
import { PREVIEW_ATTRIBUTE } from "./protocol"

// What main runs in each preview frame once it has loaded
// (main/frame-agent.ts): the agent, on the element the component is in. That
// element comes and goes (the component loads lazily, a failed one is
// mounted again), so the agent follows it. A runtime from before the marker
// has the page's root stand in. The page's full-screen view (?fullscreen=true,
// the published share page's) has no agent.

declare global {
  interface Window {
    __antidrawAgent?: true
  }
}

const params = new URLSearchParams(location.search)
const componentName = params.get("componentName")

if (componentName && params.get("fullscreen") !== "true" && !window.__antidrawAgent) {
  window.__antidrawAgent = true
  const containerNow = () =>
    document.querySelector<HTMLElement>(`[${PREVIEW_ATTRIBUTE}]`) ?? document.getElementById("root")
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
