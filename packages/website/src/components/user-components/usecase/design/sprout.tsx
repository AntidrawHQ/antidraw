/**
 * "SproutHome": a savings home screen in the sprout fintech brand
 * (motion/mvf/fintech.tsx palette and its Accounts rows), with the promo
 * card's padding, fill and heading size taken as props so a scene can tweak
 * them live. Natural size 300×600; every box the scenes point at has a fixed
 * formula (cardRect / headingRect) so outlines line up exactly.
 */
import { Bell, Home, PiggyBank, Send, User } from "lucide-react"

import { Accounts, DEEP, LIME, PALE } from "../../motion/mvf/fintech"

export const CARD_X = 20
export const CARD_Y = 116
export const CARD_W = 260
const BODY_H = 40
const BTN_H = 36

export const headingLH = (size: number) => Math.round(size * 1.2)
export const cardH = (pad: number, size: number) => 2 * pad + headingLH(size) + 6 + BODY_H + 14 + BTN_H
export const cardRect = (pad: number, size: number) => ({ x: CARD_X, y: CARD_Y, w: CARD_W, h: cardH(pad, size) })
export const headingRect = (pad: number, size: number) => ({ x: CARD_X + pad, y: CARD_Y + pad, w: CARD_W - 2 * pad, h: headingLH(size) })

const one = () => 1

export function SproutHome({ pad = 16, fill = "#FFFFFF", size = 18 }: { pad?: number; fill?: string; size?: number }) {
  return (
    <div className="absolute inset-0 overflow-hidden font-sans" style={{ background: PALE, color: DEEP }}>
      <div className="flex justify-between px-5 pt-2.5 text-[11px] font-semibold">
        <span>9:41</span>
        <span>●●● ▮</span>
      </div>
      <div className="absolute top-[44px] right-5 left-5 flex items-start justify-between">
        <div>
          <div className="text-[12px] font-medium opacity-60">Good morning, Ana</div>
          <div className="mt-0.5 text-[26px] leading-[1.1] font-black tracking-[-0.03em]">$2,481.20</div>
        </div>
        <span className="grid size-9 place-items-center rounded-full" style={{ background: DEEP, color: LIME }}>
          <Bell size={16} />
        </span>
      </div>
      <div className="absolute flex flex-col overflow-hidden rounded-[18px] shadow-[0_6px_18px_rgba(13,74,18,0.10)]" style={{ left: CARD_X, top: CARD_Y, width: CARD_W, height: cardH(pad, size), padding: pad, background: fill }}>
        <div className="font-semibold tracking-[-0.02em] whitespace-nowrap" style={{ fontSize: size, lineHeight: `${headingLH(size)}px` }}>
          Round-ups
        </div>
        <p className="mt-1.5 text-[12.5px] leading-[20px] opacity-70" style={{ height: BODY_H }}>
          Spare change from every purchase, saved for you automatically.
        </p>
        <span className="mt-3.5 flex items-center justify-center gap-1.5 rounded-[11px] text-[13px] font-semibold" style={{ height: BTN_H, background: DEEP, color: LIME }}>
          <PiggyBank size={15} /> Turn on round-ups
        </span>
      </div>
      <div className="absolute inset-x-0 top-[318px] h-[220px]">
        <Accounts sp={one} eo={one} />
      </div>
      <div className="absolute inset-x-5 bottom-3 flex items-center justify-around rounded-full py-2 shadow-[0_6px_20px_rgba(0,0,0,0.10)]" style={{ background: DEEP, color: LIME }}>
        <span className="grid size-7 place-items-center rounded-full" style={{ background: LIME, color: DEEP }}>
          <Home size={14} />
        </span>
        <PiggyBank size={14} />
        <Send size={14} />
        <User size={14} />
      </div>
    </div>
  )
}
