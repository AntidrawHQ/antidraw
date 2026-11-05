/**
 * The See Code side panel, ported from the real app's
 * components/CodeSidePanel.tsx (420px, #2A2A2A, slides in from the right on
 * cubic-bezier(0.16,1,0.3,1)) with its header's components/CopyDropdown.tsx
 * ("Copy Prompt For Agents" split button) and close X. The file renders with
 * line numbers in the app's houston colours (lib/highlight.ts), driven by
 * props instead of @pierre/diffs.
 */
import { Bot, ChevronDown, X } from "lucide-react"
import { motion, type MotionValue } from "motion/react"

import { cn } from "@/lib/utils"
import { Code } from "./chat"

export function CodePanel({ x, fileName, code, scroll, closePress = 0, className }: { x: MotionValue<number> | number; fileName: string; code: string; scroll?: MotionValue<number> | number; closePress?: number; className?: string }) {
  const lines = code.split("\n")
  return (
    <motion.div className={cn("absolute top-0 right-0 bottom-0 z-[45] flex w-[420px] flex-col border-l border-[#2d2d2d] bg-[#2A2A2A] font-sans shadow-[-24px_0_48px_rgba(0,0,0,0.25)]", className)} style={{ x }}>
      <div className="flex shrink-0 items-center justify-between gap-3 p-3 pl-4">
        <span className="min-w-0 overflow-hidden text-xs font-medium text-ellipsis whitespace-nowrap text-white/[0.88]">{fileName}</span>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center overflow-hidden rounded-lg bg-white/[0.06]">
            <span className="flex items-center gap-1.5 px-2.5 py-1.5">
              <Bot size={12} className="text-[#a3a3a3]" />
              <span className="text-[13px] font-medium whitespace-nowrap text-[#e5e5e5]">Copy Prompt For Agents</span>
            </span>
            <div className="h-4 w-px shrink-0 bg-white/10" />
            <span className="flex w-8 items-center justify-center self-stretch">
              <ChevronDown size={12} className="text-[#737373]" />
            </span>
          </div>
          <span className="flex h-7 w-7 items-center justify-center rounded-md text-white/30" style={closePress ? { background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", transform: `scale(${1 - closePress * 0.1})` } : undefined}>
            <X size={14} />
          </span>
        </div>
      </div>
      <div className="h-px shrink-0 bg-white/[0.06]" />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <motion.div className="py-2 font-mono text-[12px] leading-[20px]" style={{ y: scroll }}>
          {lines.map((l, i) => (
            <div key={i} className="flex pr-4">
              <span className="w-[52px] shrink-0 pr-4 text-right text-[#eef0f9]/30 select-none">{i + 1}</span>
              <span className="min-w-0 flex-1 whitespace-pre text-[#eef0f9]">
                <Code code={l} />
              </span>
            </div>
          ))}
        </motion.div>
      </div>
    </motion.div>
  )
}
