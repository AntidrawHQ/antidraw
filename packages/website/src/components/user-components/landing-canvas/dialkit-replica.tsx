/**
 * DialKit's panel, drawn statically: the markup DialKit's Folder (isRoot), SelectControl and Slider render,
 * with dialkit-replica.css for their look. The canvas's panels are pictures a timeline drives, never
 * controls a visitor uses, so this stands in for the dialkit package and its own copy of Motion.
 * Nothing here is focusable: the panels sit inside the canvas's aria-hidden layer.
 *
 * `active` on a slider is DialKit's hover state (a scripted pointer never hovers for real).
 */
import { useEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"
import "./dialkit-replica.css"

/** DialKit's decimals for a slider's step and bounds (its decimalsForStep). */
function decimalsFor(...values: number[]) {
  return Math.min(
    100,
    Math.max(
      ...values.map((v) => {
        const [coefficient, exponent = "0"] = String(v).toLowerCase().split("e")
        return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent))
      }),
    ),
  )
}

/** A root Folder in a panel `width` wide, titled `title`. */
export function DialPanel({ title, width, className, children }: { title: string; width: number; className?: string; children: ReactNode }) {
  return (
    <div className={cn("dialkit-root", className)} data-theme="dark" style={{ width }}>
      <div className="dialkit-panel" style={{ position: "relative", zIndex: "auto", maxHeight: "none", width: "100%" }}>
        <div className="dialkit-panel-inner" data-collapsed="false" style={{ width, height: "auto", borderRadius: 14, boxShadow: "var(--dial-shadow)", overflowY: "auto" }}>
          <div className="dialkit-folder dialkit-folder-root" data-open="true">
            <div className="dialkit-folder-header dialkit-panel-header">
              <div className="dialkit-folder-header-top">
                <div className="dialkit-folder-title-row">
                  <span className="dialkit-folder-title dialkit-folder-title-root">{title}</span>
                </div>
                <svg className="dialkit-panel-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
            </div>
            <div className="dialkit-folder-content">
              <div className="dialkit-folder-inner">{children}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** A closed SelectControl showing `value`. */
export function DialSelect({ label, value }: { label: string; value: string }) {
  return (
    <div className="dialkit-select-row">
      <div className="dialkit-select-trigger" data-open="false">
        <span className="dialkit-select-label">{label}</span>
        <div className="dialkit-select-right">
          <span className="dialkit-select-value">{value}</span>
          <svg className="dialkit-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9.5L12 15.5L18 9.5" />
          </svg>
        </div>
      </div>
    </div>
  )
}

/** Where the label and value end along the track, in %: DialKit's handle dims ("dodges") over them. */
const LABEL_LEFT = 10
const VALUE_RIGHT = 12
const HANDLE_BUFFER = 8

/** A Slider at `value`; `active` shows DialKit's hover: the handle grows in, the marks and value brighten. */
export function DialSlider({ label, value, min, max, step, active = false }: { label: string; value: number; min: number; max: number; step: number; active?: boolean }) {
  const pct = ((value - min) / (max - min)) * 100
  const wrap = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLSpanElement>(null)
  const valueRef = useRef<HTMLSpanElement>(null)
  // DialKit's defaults until measured, as on its own first render.
  const [edges, setEdges] = useState<[number, number]>([30, 78])
  useEffect(() => {
    const w = wrap.current?.offsetWidth
    if (!w) return
    setEdges([
      labelRef.current ? ((LABEL_LEFT + labelRef.current.offsetWidth + HANDLE_BUFFER) / w) * 100 : 30,
      valueRef.current ? ((w - VALUE_RIGHT - valueRef.current.offsetWidth - HANDLE_BUFFER) / w) * 100 : 78,
    ])
  }, [active])
  const dodge = pct < edges[0] || pct > edges[1]
  const steps = (max - min) / step
  const marks = steps <= 10 ? Array.from({ length: steps - 1 }, (_, i) => (((i + 1) * step) / (max - min)) * 100) : Array.from({ length: 9 }, (_, i) => (i + 1) * 10)
  return (
    <div ref={wrap} className="dialkit-slider-wrapper">
      <div className={cn("dialkit-slider", active && "dialkit-slider-active")}>
        <div className="dialkit-slider-hashmarks">
          {marks.map((m) => (
            <div key={m} className="dialkit-slider-hashmark" style={{ left: `${m}%` }} />
          ))}
        </div>
        <div className="dialkit-slider-fill" style={{ width: `${pct}%` }} />
        <div
          className="dialkit-slider-handle"
          style={{
            left: `max(5px, calc(${pct}% - 9px))`,
            opacity: !active ? 0 : dodge ? 0.1 : 0.5,
            transform: `translateY(-50%) scaleX(${active ? 1 : 0.25}) scaleY(${active && dodge ? 0.75 : 1})`,
          }}
        />
        <span ref={labelRef} className="dialkit-slider-label">
          {label}
        </span>
        <span ref={valueRef} className="dialkit-slider-value">
          {value.toFixed(decimalsFor(step, min, max))}
        </span>
      </div>
    </div>
  )
}
