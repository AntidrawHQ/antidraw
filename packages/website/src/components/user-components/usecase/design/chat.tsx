/**
 * Antidraw's chat panel, in the small pieces the designer stories need,
 * ported from the real app (packages/shell/src/renderer) with stores, IPC and
 * Radix stripped out so a timeline drives them by props:
 *
 *  - ChatPanel        Chat.tsx (AppChat: bg-[#2A2A2A], p-4 list, gap-2)
 *  - UserBubble       Chat.tsx MessageRow user branch + components/ui/message.tsx MessageContent
 *  - SentTags / Chip  inspector/TagChips.tsx (CHIP, Blocks icon)
 *  - AssistantText    Chat.tsx Markdown branch (prose-sm, transparent)
 *  - ToolGroup/ToolRow components/ui/tool.tsx (Spinner, Ring, row, ToolBody) + Chat.tsx TOOL_GROUP
 *  - DiffLines        tool.tsx ToolInput's streaming Edit (red/emerald tinted
 *                     HighlightedCode), coloured with the app's houston theme
 *  - Composer         Chat.tsx Composer + ui/prompt-input.tsx + ModelPicker / EffortDropdown triggers
 *  - Working          components/ui/message-shimmer.tsx
 */
import { ArrowUp, Blocks, ChevronDown, Gauge, Paperclip } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { ClaudeMark } from "../../motion/canvas-ai/kit"

/* ── Code colours (lib/highlight.ts → @pierre/highlights houston) ───────── */

const HC = { fg: "#eef0f9", kw: "#54b9ff", imp: "#00daef", str: "#ffd493", attr: "#4bf3c8", fn: "#00daef", com: "#eef0f98f" }
const KEYWORDS = new Set(["const", "let", "return", "function", "export", "default", "import", "from", "if", "else", "true", "false", "null"])

/** A one-line, good-enough TSX tokenizer in houston's colours. */
export function Code({ code }: { code: string }) {
  const out: ReactNode[] = []
  const re = /(\/\/.*$)|("[^"]*"|'[^']*'|`[^`]*`)|(<\/?[A-Za-z][\w.]*)|(\b[a-zA-Z_][\w-]*(?==))|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_]\w*\b)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const [s, com, str, tag, attr, num, word] = m
    const color = com ? HC.com : str ? HC.str : tag ? HC.kw : attr ? HC.attr : num ? HC.str : word && KEYWORDS.has(word) ? (word === "import" || word === "export" || word === "from" ? HC.imp : HC.kw) : undefined
    out.push(
      color ? (
        <span key={k++} style={{ color, fontStyle: com ? "italic" : undefined }}>
          {s}
        </span>
      ) : (
        s
      ),
    )
    last = m.index + s.length
  }
  if (last < code.length) out.push(code.slice(last))
  return <>{out}</>
}

/* ── Panel ──────────────────────────────────────────────────────────────── */

/** The chat side panel: header (SidePanel.tsx's p-2 border-b row), the message list (wrap each message in Reveal), the composer. */
export function ChatPanel({ title, children, composer, className }: { title: string; children: ReactNode; composer?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden border-l border-[#333] bg-[#2A2A2A] font-sans", className)}>
      <div className="flex items-center gap-1 border-b border-[#333] p-2">
        <span className="truncate px-2.5 py-0.5 text-[13px] font-medium text-neutral-400">{title}</span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
        <div className="flex flex-col p-4 pt-2" data-streaming>
          {children}
        </div>
      </div>
      {composer}
    </div>
  )
}

/* ── Messages ───────────────────────────────────────────────────────────── */

const CHIP = "inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-white/[0.06] px-2 text-xs font-medium text-white/60"

/** A tagged element as a chip: the component, then the element (TagChips.tsx). */
export function Chip({ frame, element, className }: { frame: string; element?: string; className?: string }) {
  return (
    <span className={cn(CHIP, className)}>
      <Blocks className="size-3 shrink-0 text-white/35" strokeWidth={1.75} />
      <span className="truncate">{frame}</span>
      {element && <span className="truncate text-white/35">{element}</span>}
    </span>
  )
}

export function UserBubble({ tags, children, className }: { tags?: { frame: string; element?: string }[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-end", className)}>
      {tags && tags.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5 pb-1">
          {tags.map((t, i) => (
            <Chip key={i} {...t} />
          ))}
        </div>
      )}
      <div className="max-w-[85%] rounded-[6px] bg-neutral-700 p-2 text-[13px] leading-[1.55] break-words whitespace-pre-wrap text-neutral-200">{children}</div>
    </div>
  )
}

export function AssistantText({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[13px] leading-[1.6] text-neutral-200 [&_code]:rounded-[4px] [&_code]:bg-white/[0.07] [&_code]:px-1 [&_code]:font-mono [&_code]:text-[11.5px] [&_code]:text-neutral-200", className)}>{children}</div>
}

/** "Working…", shimmering (message-shimmer.tsx). */
export function Working({ label = "Working…" }: { label?: string }) {
  return (
    <div className="flex justify-start">
      <style>{`@keyframes ucd-shimmer-text { 0% { background-position: 200% center } 100% { background-position: -200% center } }
.ucd-shimmer-text { background: linear-gradient(90deg, rgba(255,255,255,.35) 0%, rgba(255,255,255,.35) 40%, rgba(255,255,255,1) 50%, rgba(255,255,255,.35) 60%, rgba(255,255,255,.35) 100%); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: ucd-shimmer-text 2.2s linear infinite }
@media (prefers-reduced-motion: reduce) { .ucd-shimmer-text { animation: none } }`}</style>
      <span className="ucd-shimmer-text inline-block py-2 text-sm font-medium tracking-tight">{label}</span>
    </div>
  )
}

/* ── Tool calls (components/ui/tool.tsx) ────────────────────────────────── */

export const Spinner = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" className="animate-spin text-neutral-400">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeOpacity=".2" strokeWidth="1.75" />
    <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
)

export const Ring = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5" strokeOpacity=".55" />
    <path d="m8.75 12.25 2.25 2.25 4.25-4.75" />
  </svg>
)

/** One burst of calls in one outlined card, divided by hairlines (Chat.tsx TOOL_GROUP). */
export function ToolGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("my-1 divide-y divide-white/[0.06] overflow-hidden rounded-md border border-white/[0.05]", className)}>{children}</div>
}

export function ToolRow({ title, running, open, children, className }: { title: string; running?: boolean; open?: boolean; children?: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-stretch">
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2">
          <span className="grid w-4 shrink-0 place-items-center text-neutral-500">{running ? <Spinner /> : <Ring />}</span>
          <span className={cn("min-w-0 flex-1 truncate text-left text-[13px] text-neutral-300", running && "ucd-tool-shimmer")}>{title}</span>
          <ChevronDown className={cn("ml-1 size-3.5 shrink-0 text-neutral-500 transition-transform", open && "rotate-180")} />
        </div>
      </div>
      {open && children && <div className="border-t border-white/[0.06] px-2.5 py-2 font-mono text-[11px] leading-[1.6] break-all whitespace-pre-wrap">{children}</div>}
      <style>{`@keyframes ucd-tool-shimmer { from { background-position: 150% 0 } to { background-position: -50% 0 } }
.ucd-tool-shimmer { background: linear-gradient(90deg, #a3a3a3 0%, #a3a3a3 40%, #fafafa 50%, #a3a3a3 60%, #a3a3a3 100%); background-size: 200% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: ucd-tool-shimmer 1.8s linear infinite }
@media (prefers-reduced-motion: reduce) { .ucd-tool-shimmer { animation: none; background: none; color: #a3a3a3 } }`}</style>
    </div>
  )
}

export function Field({ name, value }: { name: string; value: ReactNode }) {
  return (
    <div className="text-neutral-300">
      <span className="text-neutral-500">{name}:</span> {value}
    </div>
  )
}

export type DiffLine = { n?: number; kind: "-" | "+" | " "; code: string }

/** An Edit's old/new strings as tinted lines with the file's line numbers. `shown` reveals + lines one by one. */
export function DiffLines({ lines, shown = Infinity }: { lines: DiffLine[]; shown?: number }) {
  let plus = 0
  return (
    <div className="-mx-2.5 mt-1">
      {lines.map((l, i) => {
        if (l.kind === "+" && plus++ >= shown) return null
        return (
          <div key={i} className={cn("flex min-h-[1lh] px-2.5", l.kind === "-" && "bg-red-400/[0.07]", l.kind === "+" && "bg-emerald-400/[0.07]")}>
            <span className="box-content w-[2ch] shrink-0 pr-3 text-right text-neutral-600 select-none">{l.n ?? ""}</span>
            <span className={cn("w-[1.5ch] shrink-0 select-none", l.kind === "-" ? "text-red-300/70" : l.kind === "+" ? "text-emerald-300/70" : "text-transparent")}>{l.kind}</span>
            <span className="min-w-0 flex-1 break-all whitespace-pre-wrap" style={{ color: HC.fg }}>
              <Code code={l.code} />
            </span>
          </div>
        )
      })}
    </div>
  )
}

/* ── Composer (Chat.tsx Composer + ui/prompt-input.tsx) ─────────────────── */

export function Composer({
  text,
  placeholder = "Ask me anything...",
  caret,
  chips,
  ready,
  press = 0,
  effort = true,
  className,
}: {
  text: string
  placeholder?: string
  caret?: boolean
  chips?: ReactNode
  /** The send button is live (text typed). */
  ready?: boolean
  /** 0→1 press of the send button. */
  press?: number
  /** Show the effort picker (a narrow panel drops it). */
  effort?: boolean
  className?: string
}) {
  return (
    <div className={cn("p-4 pt-2", className)}>
      <div className="cursor-text border border-neutral-600 bg-neutral-700 p-2 shadow-xs">
        {chips && <div className="flex flex-wrap gap-1.5 p-2 pb-0">{chips}</div>}
        <div className="min-h-[44px] w-full px-3 py-2 text-sm leading-[1.5] break-words whitespace-pre-wrap">
          {text ? <span className="text-neutral-50">{text}</span> : !caret && <span className="text-neutral-400">{placeholder}</span>}
          {caret && <span className="ucd-caret ml-px inline-block h-[1.05em] w-px translate-y-[2px] bg-neutral-100" />}
        </div>
        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex max-w-[170px] min-w-0 items-center gap-2 rounded-lg bg-white/[0.06] px-2.5 py-1 text-sm font-medium text-neutral-200">
              <ClaudeMark size={14} strokeWidth={2} />
              <span className="flex-1 truncate text-left">Opus 4.8</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-neutral-500" />
            </span>
            {effort && <span className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-1 text-sm font-medium text-neutral-200">
              <Gauge className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
              <span className="truncate">High</span>
              <ChevronDown className="h-3 w-3 shrink-0 text-neutral-500" />
            </span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="grid size-8 place-items-center rounded-full text-neutral-200">
              <Paperclip className="size-4" />
            </span>
            <span
              className={cn("grid size-8 place-items-center rounded-full bg-neutral-50 text-neutral-900 transition-opacity", !ready && "opacity-50")}
              style={{ transform: `scale(${1 - press * 0.12})` }}
            >
              <ArrowUp className="size-4" />
            </span>
          </div>
        </div>
      </div>
      <style>{`@keyframes ucd-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .ucd-caret { animation: ucd-caret 1s step-end infinite }`}</style>
    </div>
  )
}

/** A message arriving: its row opens (grid 0fr → 1fr) and it fades up, so the list scrolls smoothly. */
export function Reveal({ on, children, className }: { on: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid transition-[grid-template-rows,opacity,translate] duration-[380ms] ease-[cubic-bezier(.22,1,.36,1)] motion-reduce:transition-none", on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] translate-y-1 opacity-0", className)}>
      <div className="min-h-0 overflow-hidden">
        <div className="pt-2">{children}</div>
      </div>
    </div>
  )
}
