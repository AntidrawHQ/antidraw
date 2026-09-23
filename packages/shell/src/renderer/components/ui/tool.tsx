import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/renderer/components/ui/collapsible";
import { viewableComponent } from "@/renderer/lib/tool-utils";
import { cn } from "@/renderer/lib/utils";
import {
  IconCircleCheckFilled,
  IconCircleHalf2,
  IconCircleXFilled,
} from "@tabler/icons-react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { useState } from "react";

export type ToolPart = {
  type: string;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorText?: string;
};

/* ── State config ──────────────────────────────────────────────────────── */

const stateConfig = {
  "input-streaming": { icon: IconCircleHalf2, color: "#e8a040" },
  "input-available": { icon: IconCircleHalf2, color: "#e8a040" },
  "output-available": { icon: IconCircleCheckFilled, color: "#7c6cd6" },
  "output-error": { icon: IconCircleXFilled, color: "#f06060" },
} satisfies Record<string, { icon: typeof IconCircleHalf2; color: string }>;

/* ── Helpers ────────────────────────────────────────────────────────────── */

const formatValue = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
};

const getToolTitle = (toolPart: ToolPart): string => {
  const { type, input } = toolPart;
  if (typeof input?.description === "string" && input.description)
    return input.description;
  if (typeof input?.file_path === "string" && input.file_path) {
    const name = input.file_path.split("/").pop() ?? input.file_path;
    if (input.file_path.includes("/user-components/")) {
      const verb =
        type === "Write" ? "Crafting" : type === "Edit" ? "Refining" : type;
      return `${verb} ${name.replace(/\.\w+$/, "")}`;
    }
    return `${type} ${name}`;
  }
  if (typeof input?.pattern === "string" && input.pattern)
    return `${type} ${input.pattern}`;
  return type;
};

/* ── Component ─────────────────────────────────────────────────────────── */

export type ToolProps = {
  toolPart: ToolPart;
  title?: string;
  defaultOpen?: boolean;
  /** Focuses the component on the canvas. Without it, no View button shows. */
  onViewComponent?: (componentName: string) => void;
  className?: string;
};

export const Tool = ({
  toolPart,
  title,
  defaultOpen = false,
  onViewComponent,
  className,
}: ToolProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const cfg = stateConfig[toolPart.state];
  const StateIcon = cfg.icon;
  const { input, output, state } = toolPart;

  const component = onViewComponent ? viewableComponent(toolPart) : null;
  const spinning = state === "input-streaming" || state === "input-available";

  return (
    <div
      className={cn(
        "overflow-hidden rounded-sm border border-[#444] bg-[#333]",
        className,
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* items-stretch so the rail runs the row's full height */}
        <div className="flex w-full items-stretch">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-[6px] px-2.5 py-2 transition-colors hover:bg-[#3d3d3d]"
            >
              <div
                className={cn(
                  "flex shrink-0 items-center",
                  spinning && "animate-spin",
                )}
              >
                <StateIcon size={18} strokeWidth={1.75} color={cfg.color} />
              </div>
              <p className="m-0 min-w-0 flex-1 truncate text-left text-[13px] font-medium text-neutral-200">
                {title ?? getToolTitle(toolPart)}
              </p>
              {/* Inside the trigger so it shares the hover fill and expands on click */}
              <ChevronDown
                className={cn(
                  "ml-1 size-3.5 shrink-0 text-[#888] transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>

          {/* Sibling of the trigger, never a child — a nested button is invalid
              and would swallow the expand click on the way out. */}
          <div className="flex shrink-0 items-stretch">
            {component && (
              // Fills with the row's own #333 and hovers to the trigger's
              // #3d3d3d: no surface of its own, only an edge, so both halves
              // of the row lift identically.
              <button
                type="button"
                onClick={() => onViewComponent?.(component)}
                title={`View ${component}`}
                className="flex shrink-0 cursor-pointer items-center gap-1.5 self-stretch whitespace-nowrap border-l border-[#444] bg-[#333] px-2.5 text-[13px] font-medium text-neutral-400 transition-colors hover:bg-[#3d3d3d] hover:text-white"
              >
                <ArrowUpRight className="size-3.5" />
                View
              </button>
            )}
          </div>
        </div>

        <CollapsibleContent className="overflow-hidden border-t border-[#444]">
          <div className="bg-neutral-800 p-2.5 font-[ui-monospace,SFMono-Regular,Menlo,monospace] text-[11px]">
            {input &&
              Object.entries(input).map(([key, value]) => (
                <div key={key}>
                  <span className="text-neutral-500">{key}:</span>{" "}
                  <span className="whitespace-pre-wrap break-all text-neutral-200">
                    {formatValue(value)}
                  </span>
                </div>
              ))}

            {output &&
              Object.entries(output).map(([key, value]) => (
                <div key={key}>
                  <span className="text-neutral-500">{key}:</span>{" "}
                  <span className="whitespace-pre-wrap break-all text-neutral-200">
                    {formatValue(value)}
                  </span>
                </div>
              ))}

            {state === "output-error" && toolPart.errorText && (
              <div>
                <span className="text-neutral-500">error:</span>{" "}
                <span className="text-[#f06060]">{toolPart.errorText}</span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
