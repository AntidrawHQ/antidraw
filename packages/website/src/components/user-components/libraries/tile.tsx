/**
 * The shared frame for the landing's library showcases: a label row like a frame on Antidraw's
 * canvas (the library's mark, its name, who makes it), then the component itself on whatever ground
 * that library looks best on. Every tile renders real components from the real package.
 */
import type { ComponentType, ReactNode } from "react"

import { cn } from "@/lib/utils"
import type { Mark } from "../antidraw-empty/logos"

export type LibraryTile = {
  /** Stable key, e.g. "mantine". */
  id: string
  /** The library, as its makers write it: "Mantine", "Kumo". */
  library: string
  /** Who makes it: "Cloudflare", "Shopify", or "Open source". */
  maker: string
  /** The npm package the tile imports from, shown small: "@mantine/core". */
  pkg: string
  mark: Mark
  /** The tile's ground behind the component (a CSS background). */
  ground: string
  /** The component(s), rendered at the tile's size. */
  Component: ComponentType
}

/** A mark: the brand's glyph on its colour, as a small rounded square. */
export function MarkChip({ mark, className }: { mark: Mark; className?: string }) {
  return (
    <span className={cn("grid size-5 shrink-0 place-items-center overflow-hidden rounded-[5px]", className)} style={{ background: mark.bg }}>
      {mark.node}
    </span>
  )
}

/** One tile: label row, then the component in its frame. */
export function TileFrame({ tile, className, children }: { tile: LibraryTile; className?: string; children?: ReactNode }) {
  const { Component } = tile
  return (
    <figure className={cn("flex min-w-0 flex-col gap-2", className)}>
      <figcaption className="flex items-center gap-2 font-sans text-[12.5px]">
        <MarkChip mark={tile.mark} />
        <span className="font-medium text-white/85">{tile.library}</span>
        <span className="text-white/40">{tile.maker}</span>
        <span className="ml-auto truncate font-mono text-[11px] text-white/30">{tile.pkg}</span>
      </figcaption>
      <div className="relative isolate h-[300px] overflow-hidden rounded-[10px] border border-white/[0.06]" style={{ background: tile.ground }}>
        <div className="absolute inset-0 flex items-center justify-center p-6">{children ?? <Component />}</div>
      </div>
    </figure>
  )
}

/** A grid of tiles. */
export function TileGrid({ tiles, className }: { tiles: LibraryTile[]; className?: string }) {
  return (
    <div className={cn("grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {tiles.map((t) => (
        <TileFrame key={t.id} tile={t} />
      ))}
    </div>
  )
}
