/**
 * The essay landing's navbar: the logo; a link per role ("For PMs" …) that opens a menu of that
 * role's use cases in one of NavMenus' styles, each jumping to its row (#role-n, #uc-n-m, set by
 * UseCasesRows); and, once the hero's own buttons have scrolled away, a GitHub mark and a compact
 * Download. Fixed to the top, clear over the hero and frosted once the page moves under it.
 * `instant`: menus open, close and switch with no animation (the pill doesn't slide, the panel doesn't fade).
 * `shrink`: once the page moves, the bar tightens to NAV_SMALL, its logo, links and buttons with it, and
 * the compact buttons are square-cornered, as the hero's are. `cta="always"` shows the compact buttons from
 * the start, not only once the hero's own have scrolled away, and quieter: Download in a soft fill,
 * not solid, so the hero's stays the one to press. `blur={false}`: once the page moves the bar turns the
 * page's own colour (its --landing-page), solid, instead of frosted. `badge` tags the wordmark ("Alpha").
 * Below lg the role links fold into a menu button: it opens a sheet under the bar listing each role and its
 * use cases, and GitHub moves into it below sm.
 */
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown, Menu, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { USE_CASE_ROLES } from "./use-case-roles"
import { WIDE, type MenuStyle } from "./nav-menu-styles"
import iconUrl from "./antidraw-icon.svg?url"

// The menus carry every use case's scene, so they load on their own, after the page, and only where they can open.
const MegaMenu = lazy(() => import("./NavMenus").then((m) => ({ default: m.MegaMenu })))
const RoleMenu = lazy(() => import("./NavMenus").then((m) => ({ default: m.RoleMenu })))

/** The navbar's height; the page leaves this much room above the hero, and pinned rows sit below it. */
export const NAV_H = 72
/** The bar's height once the page has moved, when it shrinks. */
export const NAV_SMALL = 52

const TONE = {
  dark: {
    frost: "bg-[#262626]/80 border-white/[0.06]",
    flat: "bg-[var(--landing-page,#262626)] border-white/[0.06]",
    link: "text-white/70 hover:text-white",
    open: "text-white",
    pill: "bg-white/[0.07]",
    quiet: "text-white/45",
    line: "border-white/[0.06]",
    badge: "bg-white/[0.08] text-white/60",
    ghost: "text-white/70 hover:text-white hover:bg-white/[0.06]",
    solid: "bg-white text-[#171717]",
    soft: "bg-white/[0.08] text-white hover:bg-white/[0.13]",
  },
  light: {
    frost: "bg-[#f5f5f4]/80 border-black/[0.06]",
    flat: "bg-[var(--landing-page,#f5f5f4)] border-black/[0.06]",
    link: "text-black/60 hover:text-black",
    open: "text-black",
    pill: "bg-black/[0.05]",
    quiet: "text-black/45",
    line: "border-black/[0.06]",
    badge: "bg-black/[0.05] text-black/55",
    ghost: "text-black/60 hover:text-black hover:bg-black/[0.05]",
    solid: "bg-[#171717] text-white",
    soft: "bg-black/[0.05] text-[#171717] hover:bg-black/[0.09]",
  },
}

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })

export function EssayNav({
  theme,
  menu = "list",
  github,
  download,
  githubIcon,
  downloadIcon,
  instant = false,
  shrink = false,
  cta = "scroll",
  blur = true,
  badge,
}: {
  theme: "dark" | "light"
  menu?: MenuStyle
  github: string
  download: string
  githubIcon: ReactNode
  downloadIcon: ReactNode
  instant?: boolean
  shrink?: boolean
  cta?: "scroll" | "always"
  blur?: boolean
  badge?: string
}) {
  const t = TONE[theme]
  const [scrolled, setScrolled] = useState(false)
  const [ctaGone, setCtaGone] = useState(false)
  const [open, setOpen] = useState(-1)
  const [sheet, setSheet] = useState(false)
  const small = shrink && scrolled
  // The mega panel mounts once the page is idle, then stays mounted: opening it, or moving between roles, never mounts a card.
  // Only on a screen wide enough to show the role links (lg); below it the panel can never open, so it never mounts.
  const [megaReady, setMegaReady] = useState(false)
  useEffect(() => {
    if (menu !== "mega" || megaReady) return
    const mq = window.matchMedia("(min-width: 1024px)")
    const ric = window.requestIdleCallback ?? ((f: () => void) => window.setTimeout(f, 300))
    const cic = window.cancelIdleCallback ?? window.clearTimeout
    let id: number | undefined
    const arm = () => {
      if (mq.matches && id === undefined) id = ric(() => setMegaReady(true))
    }
    arm()
    mq.addEventListener("change", arm)
    return () => {
      mq.removeEventListener("change", arm)
      if (id !== undefined) cic(id)
    }
  }, [menu, megaReady])
  const closeTimer = useRef(0)
  const headerRef = useRef<HTMLElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    // The compact buttons come in once the hero's own have left the screen.
    const cta = document.querySelector("[data-hero-cta]")
    const io = cta ? new IntersectionObserver(([e]) => setCtaGone(!e.isIntersecting && e.boundingClientRect.top < 0)) : null
    if (cta) io!.observe(cta)
    return () => {
      window.removeEventListener("scroll", onScroll)
      io?.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!sheet) return
    const mq = window.matchMedia("(min-width: 1024px)")
    const off = () => mq.matches && setSheet(false)
    mq.addEventListener("change", off)
    return () => mq.removeEventListener("change", off)
  }, [sheet])

  // A wide menu hangs from the whole bar, so the bar and the menu are one hover zone. It watches the
  // pointer itself rather than trusting mouseleave, which the videos inside fire as they mount.
  const wideOpen = WIDE[menu] && open >= 0
  useEffect(() => {
    if (!wideOpen) return
    const inside = (el: Element | null, x: number, y: number) => {
      const r = el?.getBoundingClientRect()
      return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
    }
    const onMove = (e: PointerEvent) => {
      if (inside(headerRef.current, e.clientX, e.clientY) || inside(panelRef.current, e.clientX, e.clientY)) clearTimeout(closeTimer.current)
      else hide()
    }
    window.addEventListener("pointermove", onMove)
    return () => window.removeEventListener("pointermove", onMove)
  }, [wideOpen])

  const show = (i: number) => {
    clearTimeout(closeTimer.current)
    setOpen(i)
  }
  const hide = () => {
    closeTimer.current = window.setTimeout(() => setOpen(-1), 140)
  }

  return (
    <header
      ref={headerRef}
      className={cn("fixed inset-x-0 top-0 z-40 border-b px-5 transition-[height,background-color,border-color,backdrop-filter] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] sm:px-16", sheet ? t.flat : scrolled ? (blur ? cn(t.frost, "backdrop-blur-md") : t.flat) : "border-transparent")}
      style={{ height: small ? NAV_SMALL : NAV_H }}
    >
      <div className="flex h-full items-center justify-between lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <a href="#" onClick={(e) => (e.preventDefault(), setSheet(false), window.scrollTo({ top: 0, behavior: "smooth" }))} className="flex items-center gap-2.5 justify-self-start sm:gap-3">
          {/* A size down on a phone, so the badge, Download and the menu button fit beside it. */}
          <img src={iconUrl} alt="" className={cn("transition-[width,height] duration-300", small ? "size-[26px]" : "size-[28px] sm:size-[34px]")} />
          <span className={cn("font-medium tracking-[-0.02em] transition-[font-size] duration-300", small ? "text-[18px]" : "text-[19px] sm:text-[22px]")}>Antidraw</span>
          {badge && <span className={cn("rounded-[5px] px-1.5 py-[3px] text-[11px] leading-none font-medium tracking-[0.02em]", t.badge)}>{badge}</span>}
        </a>

        <nav className="hidden items-center gap-1 lg:flex">
          {USE_CASE_ROLES.map((r, ri) => (
            <div key={r.role} className="relative" onMouseEnter={() => show(ri)} onMouseLeave={WIDE[menu] ? undefined : hide}>
              <button
                type="button"
                onClick={() => jump(`role-${ri}`)}
                onFocus={() => show(ri)}
                onBlur={hide}
                aria-expanded={open === ri}
                className={cn("relative flex items-center gap-1 rounded-lg px-3 font-medium", small ? "h-8 text-[14px]" : "h-10 text-[15px]", !instant && "transition-colors", open === ri ? t.open : t.link)}
              >
                {/* One highlight that slides from link to link as the menu follows the pointer. */}
                {open === ri && (instant ? <span className={cn("absolute inset-0 rounded-lg", t.pill)} /> : <motion.span layoutId="essay-nav-pill" className={cn("absolute inset-0 rounded-lg", t.pill)} transition={{ type: "spring", stiffness: 500, damping: 40 }} />)}
                <span className="relative">For {r.role}</span>
                <ChevronDown className={cn("relative size-3.5 opacity-60", !instant && "transition-transform duration-200", open === ri && "rotate-180")} />
              </button>
              {!WIDE[menu] && (
                // The padding bridges the gap, so the menu doesn't close on the way down to it.
                <div className={cn("absolute top-full left-1/2 -translate-x-1/2 pt-2 transition-[opacity,translate] duration-200", open === ri ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0")}>
                  {open === ri && <Suspense fallback={null}><RoleMenu ri={ri} style={menu} theme={theme} onPick={(ci) => (jump(`uc-${ri}-${ci}`), setOpen(-1))} onRole={() => (jump(`role-${ri}`), setOpen(-1))} /></Suspense>}
                </div>
              )}
            </div>
          ))}
        </nav>
        {/* A wide menu spans the bar, under all the links. */}
        {/* It eases in and out; moving between links keeps it open and only its content changes. */}
        {menu === "mega" ? (
          (megaReady || open >= 0) &&
          (instant ? (
            // Closed, it's hidden but still mounted: data-paused (global.css) stops its cards' CSS loops until it opens.
            <div ref={panelRef} data-paused={open < 0 ? "" : undefined} className={cn("absolute inset-x-5 top-full pt-1 sm:inset-x-16", open < 0 && "pointer-events-none invisible opacity-0")}>
              <Suspense fallback={null}>
                <MegaMenu instant open={open} theme={theme} onPick={(ci, ri) => (jump(`uc-${ri}-${ci}`), setOpen(-1))} onRole={(ri) => (jump(`role-${ri}`), setOpen(-1))} />
              </Suspense>
            </div>
          ) : (
            <motion.div
              ref={panelRef}
              initial={false}
              animate={open >= 0 ? { opacity: 1, y: 0, visibility: "visible" } : { opacity: 0, y: -6, transitionEnd: { visibility: "hidden" } }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className={cn("absolute inset-x-5 top-full pt-1 sm:inset-x-16", open < 0 && "pointer-events-none")}
              data-paused={open < 0 ? "" : undefined}
              style={{ opacity: 0, visibility: "hidden" }}
            >
              <Suspense fallback={null}>
                <MegaMenu open={open} theme={theme} onPick={(ci, ri) => (jump(`uc-${ri}-${ci}`), setOpen(-1))} onRole={(ri) => (jump(`role-${ri}`), setOpen(-1))} />
              </Suspense>
            </motion.div>
          ))
        ) : (
          <AnimatePresence>
            {WIDE[menu] && open >= 0 && (
              <motion.div
                ref={panelRef}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-x-5 top-full pt-1 sm:inset-x-16"
              >
                <Suspense fallback={null}>
                  <RoleMenu ri={open} style={menu} theme={theme} onPick={(ci) => (jump(`uc-${open}-${ci}`), setOpen(-1))} onRole={() => (jump(`role-${open}`), setOpen(-1))} />
                </Suspense>
              </motion.div>
            )}
          </AnimatePresence>
        )}

        <div className={cn("flex items-center gap-1.5 justify-self-end transition-[opacity,translate] duration-300", cta === "always" || ctaGone ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0")}>
          <a href={github} target="_blank" rel="noreferrer" aria-label="Antidraw on GitHub" className={cn("hidden place-items-center rounded-lg transition-colors sm:grid", small ? "size-8" : "size-10", t.ghost)}>
            {githubIcon}
          </a>
          <a href={download} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-2 font-medium transition-[transform,background-color] active:scale-[0.97]", shrink ? "h-8 px-3.5 text-[13.5px]" : "h-10 rounded-xl px-4 text-[14.5px]", cta === "always" ? t.soft : t.solid)}>
            {downloadIcon}
            Download
          </a>
          <button type="button" onClick={() => setSheet((v) => !v)} aria-label={sheet ? "Close menu" : "Menu"} aria-expanded={sheet} className={cn("grid place-items-center rounded-lg lg:hidden", small ? "size-8" : "size-10", t.ghost)}>
            {sheet ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* The menu below lg: each role, its use cases under it, then GitHub. It fills the screen under the bar. */}
      {sheet && (
        <div className={cn("fixed inset-x-0 bottom-0 overflow-y-auto border-t px-5 pt-4 pb-10 sm:px-16 lg:hidden", t.flat)} style={{ top: small ? NAV_SMALL : NAV_H }}>
          {USE_CASE_ROLES.map((r, ri) => (
            <div key={r.role} className={cn("border-b py-4", t.line)}>
              <button type="button" onClick={() => (setSheet(false), jump(`role-${ri}`))} className="text-[19px] font-medium tracking-[-0.015em]">
                For {r.role}
              </button>
              <div className="mt-2 flex flex-col">
                {r.cases.map((c, ci) => (
                  <button key={c.title} type="button" onClick={() => (setSheet(false), jump(`uc-${ri}-${ci}`))} className={cn("py-1.5 text-left text-[15px]", t.link)}>
                    {c.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <a href={github} target="_blank" rel="noreferrer" className={cn("mt-4 flex items-center gap-2.5 py-2 text-[15px] font-medium sm:hidden", t.link)}>
            {githubIcon}
            Star on GitHub
          </a>
        </div>
      )}
    </header>
  )
}
