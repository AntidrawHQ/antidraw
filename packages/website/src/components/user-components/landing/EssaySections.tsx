/**
 * The essay landing below its hero and tour: open-source libraries and company design systems as logo
 * grids, the Split ticker of what any library makes, then the use cases by role (#role-n, #uc-n-m, which
 * the navbar's menus jump to). Shared by the essay landing and the canvas landing.
 */
import { UseCasesRows } from "./UseCases"
import { EssayIntro } from "./EssayIntro"
import { NAV_H } from "./EssayNav"

/** Which of them to render: `intro` (the logo grids and the ticker), `usecases`, or all of them (by default). The website hydrates each as its own island. */
export type SectionsPart = "intro" | "usecases"

/** `first`: the gap above the first section, the essay's 200px by default; the canvas landing's hero ends at its frames, so it sets less. */
export function EssaySections({ theme, first = "mt-28 sm:mt-[200px]", part }: { theme: "dark" | "light"; first?: string; part?: SectionsPart }) {
  if (part === "usecases")
    return (
      <div data-flow="usecases">
        <UseCasesRows theme={theme} pin={NAV_H + 16} className="mt-28 sm:mt-[200px]" />
      </div>
    )
  return (
    <>
      <EssayIntro theme={theme} first={first} />

      {/* Who it's for: a sticky role index, then one row per use case that stacks as you scroll (landing/UseCases.tsx). */}
      {part !== "intro" && (
        <div data-flow="usecases">
          <UseCasesRows theme={theme} pin={NAV_H + 16} className="mt-28 sm:mt-[200px]" />
        </div>
      )}
    </>
  )
}
