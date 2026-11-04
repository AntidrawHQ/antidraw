/**
 * `?motionT=<seconds>` for scenes on the canvas-ai kit's <Scene>: pins the shared clock at that
 * moment (posters, visual checks). The kit's clock keeps ticking, but MotionValue.attach() puts a
 * passive effect in front of every `t.set`, so each tick resolves to the pinned time instead.
 */
import { useLayoutEffect } from "react"

import { useScene } from "../../motion/canvas-ai/kit"

export function MotionSeek() {
  const { t, duration } = useScene()
  useLayoutEffect(() => {
    const seek = parseFloat(new URLSearchParams(window.location.search).get("motionT") ?? "")
    if (!Number.isFinite(seek)) return
    const at = ((seek % duration) + duration) % duration
    t.attach((_v, set) => set(at), () => {})
    t.set(at)
  }, [t, duration])
  return null
}
