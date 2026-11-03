/**
 * The landing's footer, in a few styles to choose from (LandingFooters shows them all):
 *
 *  - line      one quiet row: the mark and "© 2026 Antidraw · MIT licensed", the repo's links on the right.
 *  - columns   the logo and a line, then the page's own map: use cases by role, what it builds with, the repo.
 *  - close     a last call before it: "start on the canvas.", what it runs on, the two buttons; then the line.
 *  - closeColumns  the same last call, then the columns (the canvas landing's).
 *  - wordmark  the links, then "Antidraw" set huge and faint, cut off by the page's bottom edge.
 *  - frame     the footer as a frame on the canvas: its name above it, as the hero's frames have.
 *
 * Only links that exist: the repo, its releases and issues, and the page's own sections (#role-n,
 * #libraries, #design-systems), scrolled to smoothly.
 */
import type { ReactNode } from "react"
import { ArrowUpRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { PATHS } from "../antidraw-empty/logos"
import { USE_CASE_ROLES } from "./UseCases"
import iconUrl from "./antidraw-icon.svg?url"
import { useType } from "./TypeScale"
import { DownloadButton } from "./DownloadButton"

export type FooterStyle = "line" | "columns" | "close" | "closeColumns" | "wordmark" | "frame"
export const FOOTER_STYLES: { id: FooterStyle; name: string; note: string }[] = [
  { id: "line", name: "Sign-off", note: "One quiet row: the mark, the licence, the repo's links." },
  { id: "columns", name: "Columns", note: "The logo, then a map of the page and the repo." },
  { id: "close", name: "Last call", note: "One more ask before the line: what it runs on, the two buttons." },
  { id: "closeColumns", name: "Last call + columns", note: "The last call, then the logo and the map of the page and the repo." },
  { id: "wordmark", name: "Wordmark", note: "The links over a huge faint Antidraw, cut off by the page." },
  { id: "frame", name: "Canvas frame", note: "The footer as a frame on the canvas, named as the hero's are." },
]

const REPO = "https://github.com/AntidrawHQ/antidraw"
const RELEASES = `${REPO}/releases`
const ISSUES = `${REPO}/issues`
const LICENSE = `${REPO}/blob/main/LICENSE`

const TONE = {
  dark: {
    theme: "dark" as const,
    ink: "text-white",
    soft: "text-white/60",
    quiet: "text-white/40",
    link: "text-white/60 hover:text-white",
    line: "border-white/[0.08]",
    solid: "bg-white text-[#171717]",
    ghost: "border-white/15 bg-[#2a2a2a] text-white hover:bg-[#333]",
    frame: "bg-[#2a2a2a] ring-1 ring-white/[0.06] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]",
    label: "text-white/30",
    mark: "text-white/[0.06]",
  },
  light: {
    theme: "light" as const,
    ink: "text-[#171717]",
    soft: "text-black/55",
    quiet: "text-black/40",
    link: "text-black/55 hover:text-black",
    line: "border-black/[0.08]",
    solid: "bg-[#171717] text-white",
    ghost: "border-black/15 bg-white text-[#171717] hover:bg-black/[0.03]",
    frame: "bg-white ring-1 ring-black/[0.06] shadow-[0_12px_32px_-14px_rgba(0,0,0,0.22)]",
    label: "text-black/40",
    mark: "text-black/[0.06]",
  },
}
type Tone = (typeof TONE)[keyof typeof TONE]

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })

const AppleMark = ({ className = "size-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M16.37 12.68c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.76-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.65ZM14.1 5.92c.63-.77 1.06-1.83.94-2.89-.91.04-2.01.61-2.67 1.37-.58.67-1.1 1.76-.96 2.8 1.01.08 2.05-.52 2.69-1.28Z" />
  </svg>
)
const GithubMark = ({ className = "size-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d={PATHS.github.d} />
  </svg>
)

/** A link out (a new tab, with a small arrow) or to a section on the page. */
function A({ href, to, t, children }: { href?: string; to?: string; t: Tone; children: ReactNode }) {
  if (to)
    return (
      <a href={`#${to}`} onClick={(e) => (e.preventDefault(), jump(to))} className={cn("transition-colors", t.link)}>
        {children}
      </a>
    )
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("group relative inline-flex items-center transition-colors", t.link)}>
      {children}
      {/* Hung off the end, so the link's box stays its text and right-aligned rows line up with the column. */}
      <ArrowUpRight className="absolute left-full ml-0.5 size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
    </a>
  )
}

const Logo = ({ t, size = 28 }: { t: Tone; size?: number }) => (
  <span className={cn("flex items-center gap-2.5", t.ink)}>
    <img src={iconUrl} alt="" style={{ width: size, height: size }} />
    <span className="text-[18px] font-medium tracking-[-0.02em]">Antidraw</span>
  </span>
)

const Copyright = ({ t }: { t: Tone }) => <span className={t.quiet}>© 2026 Antidraw · MIT licensed</span>

const RepoLinks = ({ t }: { t: Tone }) => (
  <>
    <A href={REPO} t={t}>GitHub</A>
    <A href={RELEASES} t={t}>Releases</A>
    <A href={ISSUES} t={t}>Issues</A>
  </>
)

function Buttons({ t }: { t: Tone }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <DownloadButton theme={t.theme} icon={<AppleMark />} />
      <a href={REPO} target="_blank" rel="noreferrer" className={cn("inline-flex h-11 items-center gap-2 border px-5 text-[15px] font-medium transition-colors", t.ghost)}>
        <GithubMark />
        Star on GitHub
      </a>
    </div>
  )
}

function Line({ t }: { t: Tone }) {
  return (
    <div className={cn("flex flex-col gap-4 border-t pt-6 text-[14px] sm:flex-row sm:items-center sm:justify-between", t.line)}>
      <span className="flex items-center gap-3">
        <img src={iconUrl} alt="" className="size-5" />
        <Copyright t={t} />
      </span>
      <nav className="flex items-center gap-6">
        <RepoLinks t={t} />
      </nav>
    </div>
  )
}

/** The page's map: use cases by role, what it builds with, the repo. */
function SiteMap({ t }: { t: Tone }) {
  const cols: { head: string; links: ReactNode }[] = [
    { head: "Use cases", links: USE_CASE_ROLES.map((r, ri) => <A key={r.role} to={`role-${ri}`} t={t}>For {r.role}</A>) },
    {
      head: "Build with",
      links: (
        <>
          <A to="libraries" t={t}>Component libraries</A>
          <A to="design-systems" t={t}>Company design systems</A>
        </>
      ),
    },
    {
      head: "Open source",
      links: (
        <>
          <RepoLinks t={t} />
          <A href={LICENSE} t={t}>MIT licence</A>
        </>
      ),
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3">
      {cols.map((c) => (
        <div key={c.head} className="flex flex-col items-start gap-2.5 text-[14px]">
          <span className={cn("mb-1 text-[13px] font-medium", t.quiet)}>{c.head}</span>
          {c.links}
        </div>
      ))}
    </div>
  )
}

function Columns({ t }: { t: Tone }) {
  return (
    <div className={cn("border-t pt-14", t.line)}>
      <div className="grid gap-12 md:grid-cols-[1fr_auto] md:gap-20">
        <div className="flex max-w-[300px] flex-col items-start gap-4">
          <Logo t={t} />
          <p className={cn("m-0 text-[14px] leading-[1.55]", t.soft)}>Product design and prototyping canvas for your coding agents, powered by real code.</p>
        </div>
        <SiteMap t={t} />
      </div>
      <div className="mt-16 text-[13px]">
        <Copyright t={t} />
      </div>
    </div>
  )
}

/** The last call, then `End` under it: the line, or the columns. */
function Close({ t, End = Line }: { t: Tone; End?: (p: { t: Tone }) => ReactNode }) {
  const ty = useType()
  return (
    <div>
      <div className="flex flex-col items-start gap-6 pb-32">
        <h2 className={cn("m-0 font-medium", ty.lead, "mb-0", t.ink)} style={{ fontVariationSettings: '"opsz" 32' }}>
          start on the canvas.
        </h2>
        <p className={cn("m-0 max-w-[560px] text-pretty", ty.para, t.soft)}>
          Free and open source, now in alpha, for Macs with Apple Silicon or Intel. It runs Claude Code on your machine, with your own Claude account.
        </p>
        <div className="mt-2">
          <Buttons t={t} />
        </div>
      </div>
      <End t={t} />
    </div>
  )
}

const CloseColumns = ({ t }: { t: Tone }) => <Close t={t} End={Columns} />

function Wordmark({ t }: { t: Tone }) {
  return (
    <div className={cn("border-t pt-14", t.line)}>
      <div className="flex flex-col gap-6 text-[14px] sm:flex-row sm:items-center sm:justify-between">
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {USE_CASE_ROLES.map((r, ri) => (
            <A key={r.role} to={`role-${ri}`} t={t}>For {r.role}</A>
          ))}
        </nav>
        <nav className="flex items-center gap-6">
          <RepoLinks t={t} />
        </nav>
      </div>
      <div className="mt-6 text-[13px]">
        <Copyright t={t} />
      </div>
      {/* Set as wide as the column, its lower part cut off by the bottom of the page. */}
      <div aria-hidden className="relative mt-10 h-[clamp(72px,13vw,176px)] overflow-hidden">
        <span className={cn("absolute top-0 left-1/2 -translate-x-1/2 text-[clamp(110px,20vw,268px)] leading-[0.9] font-medium tracking-[-0.06em] whitespace-nowrap select-none", t.mark)}>Antidraw</span>
      </div>
    </div>
  )
}

function Frame({ t }: { t: Tone }) {
  return (
    <div className="relative">
      <span className={cn("absolute bottom-full left-0 flex h-9 items-center text-xs font-medium", t.label)}>Footer</span>
      <div className={cn("rounded-[6px] p-8 sm:p-10", t.frame)}>
        <div className="grid gap-12 md:grid-cols-[1fr_auto] md:gap-20">
          <div className="flex flex-col items-start gap-6">
            <Logo t={t} />
            <Buttons t={t} />
          </div>
          <SiteMap t={t} />
        </div>
      </div>
      <div className="mt-6 text-[13px]">
        <Copyright t={t} />
      </div>
    </div>
  )
}

/** The footer in `style`, in the landing's 1000px column. */
export function LandingFooter({ style, theme = "dark", className }: { style: FooterStyle; theme?: "dark" | "light"; className?: string }) {
  const t = TONE[theme]
  const Body = { line: Line, columns: Columns, close: Close, closeColumns: CloseColumns, wordmark: Wordmark, frame: Frame }[style]
  return (
    <footer data-flow="footer" className={cn("mx-auto max-w-[1000px]", style !== "wordmark" && "pb-12", className)}>
      <Body t={t} />
    </footer>
  )
}
