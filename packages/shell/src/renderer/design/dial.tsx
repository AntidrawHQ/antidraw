/**
 * The right panel's chrome, outside the Design section's fields (kit.tsx):
 * DialKit's surface and mono face, and the small icon button the tabs, the
 * comments and the edit bar use. The dk- classes (fonts, shimmer,
 * scrollbar) are in index.css.
 */
import type { ReactNode } from "react";
import { cn } from "@/renderer/lib/utils";

export const SURFACE = "rounded-lg bg-white/[0.05]";
export const MONO = "dk-mono";

/* ── Small buttons ─────────────────────────────────────────────────────── */

export const IconButton = ({
  title,
  onClick,
  children,
  active,
  className,
}: {
  title: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  active?: boolean;
  className?: string;
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    aria-pressed={active}
    onClick={onClick}
    className={cn(
      "grid size-6 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-white/10",
      active ? "bg-white/[0.11] text-white/95" : "text-white/50 hover:text-white/90",
      className,
    )}
  >
    {children}
  </button>
);
