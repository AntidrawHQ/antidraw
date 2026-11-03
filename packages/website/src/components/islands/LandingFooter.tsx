// One island of the canvas landing (src/pages/index.astro). Each island is its own module, so each loads only its own code.
import { LandingFooter as Footer } from "../user-components/landing/Footers"
import { TypeScaleCtx } from "../user-components/landing/TypeScale"

/** The last call and the footer's columns (as CanvasSections' CanvasFooter sets them). */
export default function LandingFooter() {
  return (
    <TypeScaleCtx.Provider value="compact">
      <Footer style="closeColumns" theme="dark" className="mt-32" />
    </TypeScaleCtx.Provider>
  )
}
