import { Panel } from "@xyflow/react";
import { MessageCircle, MousePointer2, SquareDashedMousePointer } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/renderer/components/ui/tooltip";
import { setCanvasTool, useCanvasTool, type CanvasTool } from "@/renderer/comments/store";

// The canvas's tool rail, floating at its top left. The active tool stays
// neutral: a soft white fill and a brighter icon, no mode colours.
//   Pointer   select and move frames
//   Inspect   hover and click elements inside a frame, tag them for Claude
//   Comment   click a frame to pin a comment for Claude (comments/CommentFlow)

type Mode = CanvasTool;

export const TOOLS: { id: Mode; label: string; Icon: typeof MousePointer2 }[] = [
  { id: "pointer", label: "Pointer", Icon: MousePointer2 },
  { id: "inspect", label: "Inspect", Icon: SquareDashedMousePointer },
  { id: "comment", label: "Comment", Icon: MessageCircle },
];

const railShadow = "0 4px 16px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06)";
const idle = "text-white/50 hover:bg-white/[0.05] hover:text-white/85";
const on = "text-white/95";

// One tool: also the preview window's titlebar's (PreviewWindow).
export const ToolButton = ({
  label,
  Icon,
  active,
  onClick,
  size,
  tooltipSide,
}: {
  label: string;
  Icon: typeof MousePointer2;
  active: boolean;
  onClick: () => void;
  size: number;
  tooltipSide: "right" | "bottom";
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        className={cn("relative grid place-items-center rounded-[8px]", active ? on : idle)}
        style={{ width: size, height: size }}
      >
        {active && (
          <span className="absolute inset-0 rounded-[8px] bg-white/[0.1] ring-1 ring-white/[0.06]" />
        )}
        <Icon size={16} strokeWidth={1.75} className="relative" />
      </button>
    </TooltipTrigger>
    {/* No animation, so moving between tools never lags. */}
    <TooltipContent side={tooltipSide} sideOffset={4} style={{ animation: "none" }}>
      {label}
    </TooltipContent>
  </Tooltip>
);

export const CanvasToolbar = () => {
  const mode = useCanvasTool();

  // Picking a tool selects it; picking the active one again leaves it on.
  const select = (id: Mode) => setCanvasTool(id);

  return (
    <Panel position="top-left">
      <div
        className="flex flex-col gap-0.5 rounded-[12px] bg-[#262626] p-1"
        style={{ boxShadow: railShadow }}
      >
        {TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            label={t.label}
            Icon={t.Icon}
            active={mode === t.id}
            onClick={() => select(t.id)}
            size={32}
            tooltipSide="right"
          />
        ))}
      </div>
    </Panel>
  );
};
