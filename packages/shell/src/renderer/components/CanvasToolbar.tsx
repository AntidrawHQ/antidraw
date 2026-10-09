import { Panel } from "@xyflow/react";
import { MessageCircle, MousePointer2, SquareDashedMousePointer } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/renderer/components/ui/tooltip";
import { useInspectorStore } from "@/renderer/inspector/store";

// The canvas's tool rail, floating at its top left. The active tool stays
// neutral: a soft white fill and a brighter icon, no mode colours.
//   Pointer   select and move frames
//   Inspect   hover and click elements inside a frame, tag them for Claude
//   Comment   not built yet: the button does nothing

type Mode = "pointer" | "inspect" | "comment";

const TOOLS: { id: Mode; label: string; Icon: typeof MousePointer2 }[] = [
  { id: "pointer", label: "Pointer", Icon: MousePointer2 },
  { id: "inspect", label: "Inspect", Icon: SquareDashedMousePointer },
  { id: "comment", label: "Comment", Icon: MessageCircle },
];

const railShadow = "0 4px 16px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06)";
const idle = "text-white/50 hover:bg-white/[0.05] hover:text-white/85";
const on = "text-white/95";

export const CanvasToolbar = () => {
  const inspecting = useInspectorStore((s) => s.active);
  const setInspecting = useInspectorStore((s) => s.setActive);
  const mode: Mode = inspecting ? "inspect" : "pointer";

  // Picking a tool selects it; picking the active one again leaves it on.
  const select = (id: Mode) => {
    if (id === "pointer") setInspecting(false);
    else if (id === "inspect") setInspecting(true);
  };

  return (
    <Panel position="top-left">
      <div
        className="flex flex-col gap-0.5 rounded-[12px] bg-[#262626] p-1"
        style={{ boxShadow: railShadow }}
      >
        {TOOLS.map((t) => {
          const active = mode === t.id;
          return (
            <Tooltip key={t.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => select(t.id)}
                  aria-pressed={active}
                  aria-label={t.label}
                  className={cn("relative grid place-items-center rounded-[8px]", active ? on : idle)}
                  style={{ width: 32, height: 32 }}
                >
                  {active && (
                    <span className="absolute inset-0 rounded-[8px] bg-white/[0.1] ring-1 ring-white/[0.06]" />
                  )}
                  <t.Icon size={16} strokeWidth={1.75} className="relative" />
                </button>
              </TooltipTrigger>
              {/* No animation, so moving between tools never lags. */}
              <TooltipContent side="right" sideOffset={4} style={{ animation: "none" }}>
                {t.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </Panel>
  );
};
