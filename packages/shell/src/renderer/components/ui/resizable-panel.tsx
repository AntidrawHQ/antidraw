import { useRef, useCallback } from "react";
import type { ReactNode } from "react";
import { cn } from "@/renderer/lib/utils";

type ResizablePanelProps = {
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  children: ReactNode;
  className?: string;
};

export const ResizablePanel = ({
  minWidth = 200,
  maxWidth = 500,
  defaultWidth = 280,
  children,
  className,
}: ResizablePanelProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = useCallback(() => {
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    handleRef.current?.classList.add("!bg-[#71717a]");

    const handleMouseMove = (e: MouseEvent) => {
      if (!panelRef.current) return;
      const panelLeft = panelRef.current.getBoundingClientRect().left;
      const newWidth = Math.max(
        minWidth,
        Math.min(e.clientX - panelLeft, maxWidth)
      );
      panelRef.current.style.width = `${newWidth}px`;
    };

    const handleMouseUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handleRef.current?.classList.remove("!bg-[#71717a]");
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [minWidth, maxWidth]);

  return (
    <div
      ref={panelRef}
      className={cn("relative flex flex-col overflow-hidden", className)}
      style={{ width: defaultWidth }}
    >
      {/* Resize Handle */}
      <div
        ref={handleRef}
        onMouseDown={handleResizeStart}
        className="absolute top-0 right-0 w-1 h-full z-10 cursor-col-resize transition-colors hover:bg-[#2d2d2d]"
      />

      {children}
    </div>
  );
};
