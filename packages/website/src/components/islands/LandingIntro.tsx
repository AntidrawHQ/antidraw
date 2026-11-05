// One island of the canvas landing (src/pages/index.astro). Each island is its own module, so each loads only its own code.
import { EssayIntro } from "../user-components/landing/EssayIntro"
import { TypeScaleCtx } from "../user-components/landing/TypeScale"

/** The component libraries, design systems and the ticker, under the hero (as CanvasSections sets them). */
export default function LandingIntro() {
  return (
    <TypeScaleCtx.Provider value="compact">
      <EssayIntro theme="dark" first="mt-16 sm:mt-24" />
    </TypeScaleCtx.Provider>
  )
}
