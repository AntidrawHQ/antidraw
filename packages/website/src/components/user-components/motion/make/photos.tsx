/**
 * Stand-in "photos" for the make scenes: bold gradient plates with a simple
 * illustrated subject, so the gallery reads as pictures without image files.
 */
import type { CSSProperties } from "react"
import { Bird, Bug, Fish, Flower2, Sparkles, Sun, TreePine, Waves } from "lucide-react"

import { cn } from "@/lib/utils"

export type PhotoKind = "birds" | "stars" | "humming" | "bee" | "water" | "whale" | "forest" | "pier"

const PLATES: Record<PhotoKind, string> = {
  birds: "linear-gradient(160deg, #7cc4ee 0%, #4f9fd6 55%, #2f78b8 100%)",
  stars: "radial-gradient(ellipse at 30% 30%, #5a4bb0 0%, #1c1a4a 55%, #0b0b22 100%)",
  humming: "linear-gradient(150deg, #f4e7d8 0%, #d8e6c7 50%, #a9c98f 100%)",
  bee: "linear-gradient(160deg, #ffe17a 0%, #f6b73c 60%, #e28a1d 100%)",
  water: "linear-gradient(170deg, #b9ecf2 0%, #5cc6d0 50%, #1f8e9e 100%)",
  whale: "linear-gradient(180deg, #a8d8f0 0%, #3d8fc6 50%, #16507f 100%)",
  forest: "linear-gradient(180deg, #dfe8e1 0%, #4f6f58 45%, #1f3326 100%)",
  pier: "linear-gradient(180deg, #ffcf9c 0%, #f39a6b 45%, #8a5a7c 100%)",
}

export function Photo({ kind, className, style }: { kind: PhotoKind; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ background: PLATES[kind], ...style }}>
      {kind === "birds" &&
        [
          [18, 30, 18],
          [42, 22, 22],
          [62, 44, 16],
          [30, 58, 20],
          [70, 66, 24],
          [52, 74, 14],
        ].map(([l, t, s], i) => <Bird key={i} size={s} className="absolute text-[#1b3d2a]" style={{ left: `${l}%`, top: `${t}%`, transform: `rotate(${i * 23 - 40}deg)` }} strokeWidth={2.2} />)}
      {kind === "stars" && (
        <>
          {Array.from({ length: 22 }, (_, i) => (
            <span key={i} className="absolute rounded-full bg-white" style={{ left: `${(i * 37) % 97}%`, top: `${(i * 53) % 91}%`, width: (i % 3) + 1.5, height: (i % 3) + 1.5, opacity: 0.5 + (i % 4) * 0.15 }} />
          ))}
          <Sparkles className="absolute top-[36%] left-[40%] text-[#f1d7ff]" size={30} />
          <div className="absolute inset-x-[-20%] top-[45%] h-[18%] rotate-[-20deg] bg-[#c9b3ff]/25 blur-md" />
        </>
      )}
      {kind === "humming" && (
        <>
          <Flower2 className="absolute right-[12%] bottom-[14%] text-[#d1497b]" size={34} strokeWidth={1.8} />
          <Bird className="absolute top-[24%] left-[22%] text-[#2f6b4f]" size={42} strokeWidth={1.8} />
        </>
      )}
      {kind === "bee" && (
        <>
          <Flower2 className="absolute bottom-[10%] left-[14%] text-[#fff5d1]" size={40} strokeWidth={1.6} />
          <Bug className="absolute top-[22%] right-[20%] text-[#3a2508]" size={30} strokeWidth={2} />
        </>
      )}
      {kind === "water" && (
        <>
          <Waves className="absolute bottom-[18%] left-[18%] text-white/80" size={46} strokeWidth={1.6} />
          <Sun className="absolute top-[14%] right-[16%] text-[#fff6c4]" size={24} />
        </>
      )}
      {kind === "whale" && (
        <>
          <Fish className="absolute top-[30%] left-[24%] rotate-[-30deg] text-[#0d2c47]" size={54} strokeWidth={1.6} />
          <div className="absolute inset-x-0 bottom-0 h-[30%] bg-white/25" />
        </>
      )}
      {kind === "forest" &&
        [10, 30, 52, 72].map((l, i) => <TreePine key={i} className="absolute bottom-[8%] text-[#0f1f15]" size={34 + (i % 2) * 14} style={{ left: `${l}%` }} strokeWidth={1.7} />)}
      {kind === "pier" && (
        <>
          <Sun className="absolute top-[22%] left-[40%] text-[#fff1c9]" size={30} />
          <div className="absolute inset-x-0 bottom-0 h-[38%] bg-[#4a3a63]/60" />
          {[12, 30, 48, 66, 84].map((l) => (
            <span key={l} className="absolute bottom-[12%] h-[30%] w-[3px] bg-[#2a1f33]" style={{ left: `${l}%` }} />
          ))}
        </>
      )}
    </div>
  )
}
