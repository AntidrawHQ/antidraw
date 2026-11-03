/**
 * Under the company tiles: more design systems from companies, as mark + library name chips.
 * Marks come from MARKS where they exist; Supabase, Clerk and Resend are Simple Icons
 * (simpleicons.org, CC0) paths in the same `{ bg, node }` shape.
 */
import { cn } from "@/lib/utils"
import { MARKS } from "../../antidraw-empty/logos"
import type { Mark } from "../../antidraw-empty/logos"
import { MarkChip } from "../tile"

const si = (d: string, bg: string): Mark => ({
  bg,
  node: (
    <svg viewBox="0 0 24 24" className="size-4" fill="#fff" aria-hidden="true">
      <path d={d} />
    </svg>
  ),
})

const supabase = si(
  "M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z",
  "#3FCF8E",
)
const clerk = si(
  "m21.47 20.829-2.881-2.881a.572.572 0 0 0-.7-.084 6.854 6.854 0 0 1-7.081 0 .576.576 0 0 0-.7.084l-2.881 2.881a.576.576 0 0 0-.103.69.57.57 0 0 0 .166.186 12 12 0 0 0 14.113 0 .58.58 0 0 0 .239-.423.576.576 0 0 0-.172-.453Zm.002-17.668-2.88 2.88a.569.569 0 0 1-.701.084A6.857 6.857 0 0 0 8.724 8.08a6.862 6.862 0 0 0-1.222 3.692 6.86 6.86 0 0 0 .978 3.764.573.573 0 0 1-.083.699l-2.881 2.88a.567.567 0 0 1-.864-.063A11.993 11.993 0 0 1 6.771 2.7a11.99 11.99 0 0 1 14.637-.405.566.566 0 0 1 .232.418.57.57 0 0 1-.168.448Zm-7.118 12.261a3.427 3.427 0 1 0 0-6.854 3.427 3.427 0 0 0 0 6.854Z",
  "#6C47FF",
)
const resend = si(
  "M14.679 0c4.648 0 7.413 2.765 7.413 6.434s-2.765 6.434-7.413 6.434H12.33L24 24h-8.245l-8.88-8.44c-.636-.588-.93-1.273-.93-1.86 0-.831.587-1.565 1.713-1.883l4.574-1.224c1.737-.465 2.936-1.81 2.936-3.572 0-2.153-1.761-3.4-3.939-3.4H0V0z",
  "#000000",
)

export type CompanySystem = { library: string; maker: string; mark: Mark }

export const COMPANY_SYSTEMS: CompanySystem[] = [
  { library: "Carbon", maker: "IBM", mark: MARKS.ibm },
  { library: "Atlassian Design System", maker: "Atlassian", mark: MARKS.atlassian },
  { library: "Lightning", maker: "Salesforce", mark: MARKS.salesforce },
  { library: "Base Web", maker: "Uber", mark: MARKS.uber },
  { library: "Gestalt", maker: "Pinterest", mark: MARKS.pinterest },
  { library: "Paste", maker: "Twilio", mark: MARKS.twilio },
  { library: "EUI", maker: "Elastic", mark: MARKS.elastic },
  { library: "Canvas", maker: "Workday", mark: MARKS.workday },
  { library: "Supabase UI", maker: "Supabase", mark: supabase },
  { library: "Clerk Components", maker: "Clerk", mark: clerk },
  { library: "React Email", maker: "Resend", mark: resend },
]

export function CompanyLogoStrip({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4 font-sans", className)}>
      <p className="text-[13px] text-white/45">and the ones your team already uses</p>
      <ul className="flex flex-wrap gap-2">
        {COMPANY_SYSTEMS.map((s) => (
          <li
            key={s.library}
            className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] py-1.5 pl-1.5 pr-3 text-[12.5px]"
          >
            <MarkChip mark={s.mark} className="rounded-full" />
            <span className="text-white/80">{s.library}</span>
            <span className="text-white/35">{s.maker}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
