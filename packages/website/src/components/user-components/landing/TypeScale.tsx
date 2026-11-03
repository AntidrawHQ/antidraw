/**
 * The landing sections' type sizes. The essay's are set against its 48px title; `compact`, for the canvas
 * landing, against its 32px one, so no heading below outgrows the hero: headings at 28, body at 17.
 * The page sets it with TypeScaleCtx; the sections read it with useType().
 */
import { createContext, useContext } from "react"

export type TypeScale = "essay" | "compact"
export const TypeScaleCtx = createContext<TypeScale>("essay")

const TYPE = {
  essay: {
    /** The first section's heading, a step above the rest. */
    lead: "mb-6 text-balance text-[36px] leading-[1.08] tracking-[-0.032em] sm:text-[48px]",
    h2: "mb-6 text-balance text-[30px] leading-[1.12] tracking-[-0.028em] sm:text-[36px]",
    para: "text-[18px] leading-[1.55] tracking-[-0.01em] sm:text-[20px]",
    /** The ticker's big sentence and its library mark, px. */
    ticker: "text-[28px] sm:text-[40px]",
    tickerMark: 36,
    role: "text-[30px]",
    pitch: "text-[18px]",
    case: "text-[24px]",
    line: "text-[18px]",
  },
  compact: {
    lead: "mb-4 text-balance text-[26px] leading-[1.12] tracking-[-0.025em] sm:text-[28px]",
    h2: "mb-4 text-balance text-[26px] leading-[1.12] tracking-[-0.025em] sm:text-[28px]",
    para: "text-[16px] leading-[1.55] tracking-[-0.008em] sm:text-[17px]",
    ticker: "text-[24px] sm:text-[30px]",
    tickerMark: 28,
    role: "text-[22px]",
    pitch: "text-[16px]",
    case: "text-[19px]",
    line: "text-[16px]",
  },
}

export const useType = () => TYPE[useContext(TypeScaleCtx)]
