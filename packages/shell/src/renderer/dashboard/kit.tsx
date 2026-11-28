import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { WorkspaceWithThumbnail } from "@/main/api";
import { getWorkspaceThumbnail } from "@/renderer/lib/api";
import { queryKeys } from "@/renderer/lib/query-keys";
import { cn } from "@/renderer/lib/utils";
import { fit, leastWidth, readCapture, type Capture } from "./crop";

// The dashboard's small parts, the titlebar tabs' and the published viewer's:
// its own icons, button, chip and thumbnail, in the greys of its design
// rather than the workspace view's.

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
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  sort: <path d="M7.5 5v14m0 0-3.5-3.5M7.5 19l3.5-3.5M16.5 19V5m0 0L13 8.5M16.5 5 20 8.5" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />,
  eye: (
    <>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />,
  fork: (
    <>
      <circle cx="7" cy="5.5" r="2.2" />
      <circle cx="17" cy="5.5" r="2.2" />
      <circle cx="12" cy="18.5" r="2.2" />
      <path d="M7 7.7v1.8a3 3 0 0 0 3 3h4a3 3 0 0 0 3-3V7.7M12 12.5v3.8" />
    </>
  ),
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

export const Chip = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <span
    className={cn(
      "inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full bg-[#313131] px-2 text-[12px] whitespace-nowrap text-[#B2B2B2]",
      className,
    )}
  >
    {children}
  </span>
);

// The workspace's canvas as last captured (lib/thumbnail.ts), on the canvas's
// own grey: a workspace that hasn't been captured yet is that grey alone.
// It's zoomed to the frames on it (./crop), not shown whole: a capture is the
// canvas as the window had it, with the frames small in the middle. What the
// tile has past the capture's edge is the grey the capture already has
// there. A capture with nothing on its canvas is shown whole.
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
  // The capture, once it's been read: its URL, its shape, and where its frames are.
  const [shown, setShown] = useState<Capture & { url: string }>();
  // The tile's own shape: what's shown is fitted to both.
  const [tile, setTile] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!jpeg) return;
    const made = URL.createObjectURL(jpeg);
    let current = true;
    void readCapture(jpeg, `${id}:${version}`)
      // One that can't be read is shown whole.
      .catch((): Capture => ({ ratio: 1, frames: null }))
      .then((capture) => {
        if (current) setShown({ url: made, ...capture });
      });
    return () => {
      current = false;
      setShown(undefined);
      URL.revokeObjectURL(made);
    };
  }, [jpeg, id, version]);

  const part =
    shown?.frames && tile
      ? fit(shown.frames, shown.ratio, tile.clientWidth / tile.clientHeight, leastWidth(tile.clientWidth))
      : null;
  return (
    <div ref={setTile} className={cn("relative overflow-hidden bg-[#282828]", className)}>
      {shown && (
        <img
          src={shown.url}
          alt=""
          draggable={false}
          className={cn("absolute max-w-none", !part && "inset-0 size-full object-contain")}
          style={
            part
              ? {
                  left: `${(-part.x / part.width) * 100}%`,
                  top: `${(-part.y / part.height) * 100}%`,
                  width: `${100 / part.width}%`,
                  height: `${100 / part.height}%`,
                }
              : undefined
          }
        />
      )}
    </div>
  );
};

export const menuItem =
  "flex w-full items-center rounded-[6px] px-2.5 py-1.5 text-left text-[13px] hover:bg-[#373737]";
export const MENU = "rounded-[10px] bg-[#2A2A2A] p-1 shadow-[0_0_0_1px_#373737,0_16px_40px_-8px_rgba(0,0,0,0.7)]";
