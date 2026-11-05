// One island of the canvas landing (src/pages/index.astro). Each island is its own module, so each loads only its own code.
import { FooterWordmark } from "../user-components/landing/FooterWordmark"

/** The page's sign-off: the wordmark over the glowing columns, the full width of the page. Its parts answer clicks with easter eggs. */
export default function LandingWordmark() {
  return <FooterWordmark />
}
