// One island of the canvas landing (src/pages/index.astro). Each island is its own module, so each loads only its own code.
import { EssaySections } from "../user-components/landing/EssaySections"
import { TypeScaleCtx } from "../user-components/landing/TypeScale"

/** The use cases by role, with their scenes (as CanvasSections sets them). */
export default function LandingUseCases() {
  return (
    <TypeScaleCtx.Provider value="compact">
      <EssaySections theme="dark" part="usecases" />
    </TypeScaleCtx.Provider>
  )
}
