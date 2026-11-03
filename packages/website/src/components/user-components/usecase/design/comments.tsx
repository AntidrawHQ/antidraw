/**
 * Antidraw's comment pieces, ported for the designer stories from the real
 * app (packages/shell/src/renderer), with the stores and frame bridge
 * stripped so a timeline drives them:
 *
 *  - CommentBox   comments/pieces.tsx CommentBoxAt (blue pin + #353535 box, "Leave a comment for Claude…", ↵ kbd)
 *  - Pin          comments/placed.tsx PinMark (draft: white numbered; sent: small grey; open: blue)
 *  - OutboxCard   design/Outbox.tsx Card (You avatar, status: pin badge / Working / done, frame · element · Chat n,
 *                 the agent's note threaded under it)
 *  - OutboxFilter design/Outbox.tsx Filter (Open · Resolved with counts)
 *  - NotSentFoot  design/Outbox.tsx foot ("Not sent yet", the drafts, SendBar in ocean blue)
 *  - CommentsEmpty design/sections.tsx Empty with the Outbox's "No comments yet" copy
 */
import Avatar from "boring-avatars"
import { ArrowUp, ArrowUpRight, MessageCircle } from "lucide-react"
import type { CSSProperties, ReactNode } from "react"

import { cn } from "@/lib/utils"
import { MONO } from "./panel"

export const FLOAT = "rounded-[12px] bg-[#353535]"
export const floatShadow: CSSProperties = { boxShadow: "0 5px 20px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.1), inset 0 1px 0 rgba(255,255,255,.05)" }
export const BOX = 260

export const Kbd = ({ children }: { children: ReactNode }) => <span className="rounded-sm bg-white/[0.06] px-1 py-px font-mono text-[10.5px] leading-none text-neutral-500">{children}</span>

/** The open comment box: its blue pin at (x, y) and the field beside it (left/top), in stage coordinates. */
export function CommentBox({ x, y, left, top, text, caret }: { x: number; y: number; left: number; top: number; text: string; caret?: boolean }) {
  return (
    <div className="pointer-events-none">
      <span className="absolute z-40 size-5 -translate-y-full rounded-full rounded-bl-none bg-[#3b82f6] shadow-[0_2px_6px_rgba(0,0,0,.35)] ring-2 ring-white/90" style={{ left: x, top: y }} />
      <div className={cn("absolute z-40 flex items-end gap-1.5 px-3 py-2 ring-1 ring-white/20", FLOAT)} style={{ ...floatShadow, left, top, width: BOX }}>
        <div className="min-w-0 flex-1 py-0.5 text-[13px] leading-[20px] break-words text-neutral-100">
          {text}
          {caret && <span className="ucd-caret mr-px inline-block h-[14px] w-px translate-y-[2px] bg-neutral-100" />}
          {!text && <span className="text-neutral-500">Leave a comment for Claude…</span>}
        </div>
        <Kbd>↵</Kbd>
      </div>
      <style>{`@keyframes ucd-caret { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } } .ucd-caret { animation: ucd-caret 1s step-end infinite }`}</style>
    </div>
  )
}

/** A pin on the canvas (placed.tsx PinMark). */
export function Pin({ x, y, n, state, lit, style }: { x: number; y: number; n?: number; state: "draft" | "sent" | "open"; lit?: boolean; style?: CSSProperties }) {
  return (
    <span
      className={cn(
        "absolute z-10 grid -translate-y-full place-items-center rounded-full rounded-bl-none text-[10px] leading-none font-semibold shadow-[0_2px_6px_rgba(0,0,0,.35)] transition-[width,height,background-color,transform] duration-200",
        state === "open" ? "size-5 bg-[#3b82f6] text-white ring-2 ring-white/90" : state === "draft" ? "size-5 bg-neutral-100 text-neutral-900" : "size-4 bg-[#4a4a4a] text-neutral-300 ring-1 ring-white/15",
        lit && state !== "open" && "scale-125 ring-2 ring-[#3b82f6]",
      )}
      style={{ left: x, top: y, transformOrigin: "bottom left", ...style }}
    >
      {state === "draft" ? n : ""}
    </span>
  )
}

const PALETTE = ["#c084a0", "#84a0c0", "#a0c084", "#c0a084", "#84c0a0"]

const You = ({ size = 18 }: { size?: number }) => (
  <span className="shrink-0 overflow-hidden rounded-[5px]" style={{ width: size, height: size }}>
    <Avatar size={size} name="you" variant="marble" colors={PALETTE} square />
  </span>
)

const Agent = ({ size = 16 }: { size?: number }) => (
  <span className="relative shrink-0 overflow-hidden rounded-[4px]" style={{ width: size, height: size, background: "linear-gradient(180deg, #3A5FB0, #1B3474)" }}>
    <svg viewBox="0 0 16 16" className="absolute inset-0 size-full">
      <rect x="6.5" y="6.5" width="6" height="6" rx="1.4" fill="#fff" opacity=".5" />
      <rect x="3.5" y="3.5" width="6" height="6" rx="1.4" fill="#F4F7FD" />
    </svg>
  </span>
)

const Spinner = ({ className }: { className?: string }) => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" className={cn("animate-spin", className)} style={{ animationDuration: "1.1s" }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".18" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
)

const PinBadge = ({ n }: { n?: number }) => <span className="grid size-4 place-items-center rounded-full rounded-bl-none bg-neutral-100 text-[9.5px] leading-none font-semibold text-neutral-900">{n}</span>

const Done = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5" strokeOpacity=".5" />
    <path d="m8.5 12.2 2.4 2.3 4.6-4.9" />
  </svg>
)

export type CardKind = "draft" | "working" | "done"

export function OutboxCard({ kind, n, text, frame, element, chat, note, ago = "now", lit }: { kind: CardKind; n?: number; text: string; frame: string; element?: string; chat?: number; note?: string; ago?: string; lit?: boolean }) {
  return (
    <div className={cn("group flex gap-2.5 rounded-lg px-2.5 py-2.5 transition-colors", lit && "bg-white/[0.06]")}>
      <You />
      <div className="min-w-0 flex-1">
        <div className="flex h-[18px] items-center gap-1.5">
          <span className="text-[12.5px] font-medium text-white/85">You</span>
          <span className="text-[11.5px] text-white/35">{ago}</span>
          <span className="flex-1" />
          <span className="flex items-center">
            {kind === "draft" ? (
              <PinBadge n={n} />
            ) : kind === "working" ? (
              <span className="flex items-center gap-1.5 text-[11.5px]">
                <Spinner className="text-white/55" />
                <span className="ucd-dk-shimmer">Working</span>
              </span>
            ) : (
              <span className="text-white/40">
                <Done />
              </span>
            )}
          </span>
        </div>
        <p className={cn("m-0 mt-0.5 text-[13px] leading-[19px] break-words", kind === "done" ? "text-white/55" : "text-white/85")}>{text}</p>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] whitespace-nowrap text-white/35">
          <span className="min-w-0 truncate">{frame}</span>
          {element && (
            <>
              <span className="shrink-0 text-white/20">·</span>
              <span className={cn(MONO, "shrink-0 text-[11px]")}>{element}</span>
            </>
          )}
          {chat !== undefined && (
            <>
              <span className="shrink-0 text-white/20">·</span>
              <span className="inline-flex shrink-0 items-center gap-0.5">
                Chat {chat}
                <ArrowUpRight className="size-3" />
              </span>
            </>
          )}
        </div>
        {kind === "done" && note && (
          <div className="mt-2.5 flex gap-2 border-l border-white/10 pl-2.5">
            <Agent />
            <div className="min-w-0 flex-1">
              <div className="flex h-4 items-center gap-1.5">
                <span className="text-[12px] font-medium text-white/75">Agent</span>
                <span className="text-[11.5px] text-white/35">now</span>
              </div>
              <p className="m-0 mt-0.5 text-[12.5px] leading-[18px] break-words text-white/60">{note}</p>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes ucd-dk-shimmer { 0% { background-position: 200% center } 100% { background-position: -200% center } }
.ucd-dk-shimmer { background: linear-gradient(90deg, rgba(255,255,255,.4) 0%, rgba(255,255,255,.4) 40%, rgba(255,255,255,.95) 50%, rgba(255,255,255,.4) 60%, rgba(255,255,255,.4) 100%); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: ucd-dk-shimmer 2s linear infinite }
@media (prefers-reduced-motion: reduce) { .ucd-dk-shimmer { animation: none } }`}</style>
    </div>
  )
}

export function OutboxFilter({ value, open, resolved }: { value: "open" | "resolved"; open: number; resolved: number }) {
  return (
    <div className="flex h-8 items-center justify-between pr-1 pl-1">
      <div className="flex items-center gap-0.5">
        {(
          [
            ["open", "Open", open],
            ["resolved", "Resolved", resolved],
          ] as const
        ).map(([v, label, count]) => (
          <span key={v} className={cn("flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium", value === v ? "bg-white/[0.06] text-white/85" : "text-white/40")}>
            {label}
            {count > 0 && <span className={cn(MONO, "text-[11px] text-white/30")}>{count}</span>}
          </span>
        ))}
      </div>
    </div>
  )
}

const OCEAN = "#236CB6"

export function SendBar({ count, press = 0 }: { count: number; press?: number }) {
  return (
    <span
      className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium"
      style={{ borderRadius: 8, background: OCEAN, color: "#FFFFFF", boxShadow: `inset 0 1px 0 rgba(255,255,255,0.28), 0 6px 18px -6px color-mix(in srgb, ${OCEAN} 45%, transparent)`, transform: `scale(${1 - press * 0.04})`, filter: `brightness(${1 + press * 0.12})` }}
    >
      {count === 1 ? "Send 1 comment to chat" : `Send ${count} comments to chat`}
      <ArrowUp className="size-3.5" />
    </span>
  )
}

export function NotSentFoot({ children, count, press }: { children: ReactNode; count: number; press?: number }) {
  return (
    <div className="flex shrink-0 flex-col border-t border-white/[0.05]">
      <div className="flex h-8 items-center gap-1.5 px-3.5 pt-1.5">
        <span className="text-[11.5px] font-medium text-white/35">Not sent yet</span>
      </div>
      <div className="flex flex-col gap-0.5 px-1.5">{children}</div>
      <div className="p-3 pt-2">
        <SendBar count={count} press={press} />
      </div>
    </div>
  )
}

export function CommentsEmpty() {
  return (
    <div className="flex flex-col gap-4 px-3 pt-5">
      <div className="flex flex-col items-start gap-3 px-1">
        <span className="grid size-9 place-items-center rounded-lg bg-white/[0.05] text-white/60">
          <MessageCircle className="size-4" strokeWidth={1.75} />
        </span>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-white/85">No comments yet</span>
          <p className="m-0 text-[12.5px] leading-[18px] text-white/45">Pick the Comment tool (C), then click anywhere on a frame to pin a note for the agent. Nothing goes out until you send.</p>
        </div>
      </div>
    </div>
  )
}
