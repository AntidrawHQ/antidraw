// One island of the canvas landing (src/pages/index.astro). Each island is its own module, so each loads only its own code.
import { CanvasHero } from "../user-components/AntidrawLandingCanvas"

/** The first screen: the canvas, its title and the navbar. Hydrates as the page loads. */
export default function LandingHero() {
  return <CanvasHero theme="dark" />
}
