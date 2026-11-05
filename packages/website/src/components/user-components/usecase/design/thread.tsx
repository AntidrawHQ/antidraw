/**
 * The chat side panel as the real app shows a conversation, for the
 * one-video-per-use-case stories (ported from
 * packages/shell/src/renderer/SidePanel.tsx and ChatEmptyState.tsx):
 *
 *  - ThreadPanel  ConversationView: "← Chats / title", a + for a new chat,
 *                 the messages (wrap each in chat.tsx Reveal), the composer
 *  - EmptyThread  ChatEmptyState, before the first message
 *  - FileChip     an attached file, in the composer and on the sent message
 */
import { ArrowLeft, FileText, Plus } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export function ThreadPanel({ title, children, composer, className }: { title: string; children: ReactNode; composer: ReactNode; className?: string }) {
  return (
    <div className={cn("flex h-full flex-col overflow-hidden border-r border-[#333] bg-[#2A2A2A] font-sans", className)}>
      <div className="flex items-center gap-1 border-b border-[#333] p-2">
        <nav className="flex min-w-0 flex-1 items-center gap-1 text-[13px] font-medium">
          <span className="flex h-6 shrink-0 items-center gap-1 rounded-md pr-2 pl-1.5 text-neutral-500">
            <ArrowLeft className="size-4" />
            Chats
          </span>
          <span className="shrink-0 text-neutral-600">/</span>
          <span className="truncate pl-2 text-neutral-400">{title}</span>
        </nav>
        <span className="rounded-md p-1 text-[#71717a]">
          <Plus className="size-4" />
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col justify-end overflow-hidden">
        <div className="flex flex-col p-4 pt-2">{children}</div>
      </div>
      {composer}
    </div>
  )
}

export const EmptyThread = () => (
  <div className="flex flex-col items-start pb-2">
    <span className="text-sm font-medium tracking-[-0.02em] text-[#b0b0b0]">Chat to create designs.</span>
    <p className="m-0 mt-1.5 max-w-[280px] text-xs leading-normal text-[#787878]">Describe a component, screen, or interaction. Ask for multiple versions to see different directions.</p>
  </div>
)

export function FileChip({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-white/[0.06] px-2 text-xs font-medium text-white/60", className)}>
      <FileText className="size-3 shrink-0 text-white/35" strokeWidth={1.75} />
      <span className="truncate">{name}</span>
    </span>
  )
}
