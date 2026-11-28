import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { WorkspaceWithThumbnail } from "@/main/api";
import { getWorkspaceThumbnail } from "@/renderer/lib/api";
import { queryKeys } from "@/renderer/lib/query-keys";
import { cn } from "@/renderer/lib/utils";

// The dashboard's small parts, and the titlebar tabs': its own icons, button
// and thumbnail, in the greys of its design rather than the workspace view's.

export const Svg = ({
  children,
  size = 16,
  className = "",
  sw = 1.6,
}: {
  children: ReactNode;
  size?: number;
  className?: string;
  sw?: number;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);

export const ic = {
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
    </>
  ),
  plus: <path d="M5 12h14M12 5v14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </>
  ),
  down: <path d="m7 10 5 5 5-5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />,
};

type BtnKind = "primary" | "secondary" | "ghost" | "outline";
const KINDS: Record<BtnKind, string> = {
  primary: "bg-[#F2F2F2] font-medium text-[#222222] hover:bg-white",
  secondary: "bg-[#373737] text-[#EBEBEB] hover:bg-[#424242]",
  ghost: "text-[#B2B2B2] hover:bg-[#313131] hover:text-[#EBEBEB]",
  outline: "text-[#E9E9E9] ring-1 ring-inset ring-[#484848] hover:bg-[#313131]",
};

export const Btn = ({
  kind = "secondary",
  small,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; small?: boolean }) => (
  <button
    {...props}
    className={cn(
      "flex shrink-0 items-center justify-center gap-1.5 rounded-[8px] whitespace-nowrap disabled:opacity-50",
      small ? "h-[28px] px-2.5 text-[12.5px]" : "h-[34px] px-3.5 text-[13.5px]",
      KINDS[kind],
      className,
    )}
  />
);

// The workspace's canvas as last captured (lib/thumbnail.ts), on the canvas's
// own grey: a workspace that hasn't been captured yet is that grey alone.
// The capture is shown whole, not cropped to the tile: it has the shape the
// canvas had in the window, often taller than wide beside the chat, and the
// grey around it is the grey it already has at its edges.
export const WorkspaceThumb = ({
  workspace,
  className = "",
}: {
  workspace: Pick<WorkspaceWithThumbnail, "id" | "thumbnailVersion">;
  className?: string;
}) => {
  const { id, thumbnailVersion: version } = workspace;
  const { data: jpeg } = useQuery({
    queryKey: queryKeys.workspaces.thumbnail(id, version),
    queryFn: version === null ? skipToken : () => getWorkspaceThumbnail(id, version),
    staleTime: Infinity,
  });
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!jpeg) return;
    const made = URL.createObjectURL(jpeg);
    setUrl(made);
    return () => {
      setUrl(undefined);
      URL.revokeObjectURL(made);
    };
  }, [jpeg]);

  return (
    <div className={cn("relative overflow-hidden bg-[#282828]", className)}>
      {url && <img src={url} alt="" draggable={false} className="absolute inset-0 size-full object-contain" />}
    </div>
  );
};

// For a menu: closes on a press outside it, and on Esc.
export const useOutside = (open: boolean, close: () => void) => {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(close);
  latest.current = close;

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) latest.current();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") latest.current();
    };
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return ref;
};

export const menuItem =
  "flex w-full items-center rounded-[6px] px-2.5 py-1.5 text-left text-[13px] hover:bg-[#373737]";
export const MENU = "rounded-[10px] bg-[#2A2A2A] p-1 shadow-[0_0_0_1px_#373737,0_16px_40px_-8px_rgba(0,0,0,0.7)]";
