import { viewableComponent } from "@/renderer/lib/tool-utils";
import { cn } from "@/renderer/lib/utils";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { memo, useState } from "react";

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

/* ── Icons ─────────────────────────────────────────────────────────────── */

// Monochrome status, from the ToolCallsMono "Ghost" design: a grey arc
// spinning while running, an outline ring with a check or × once settled.
// The spin is a transform, so it stays on the compositor.
const Spinner = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    className="animate-spin text-neutral-400"
  >
    <circle
      cx="12"
      cy="12"
      r="8.5"
      stroke="currentColor"
      strokeOpacity=".2"
      strokeWidth="1.75"
    />
    <path
      d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
  </svg>
);

const Ring = ({ failed }: { failed: boolean }) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="8.5" strokeOpacity=".55" />
    {failed ? (
      <path d="m9.5 9.5 5 5m0-5-5 5" />
    ) : (
      <path d="m8.75 12.25 2.25 2.25 4.25-4.75" />
    )}
  </svg>
);

/* ── Component ─────────────────────────────────────────────────────────── */

// Its own component so the input/output stringification below only runs while
// the panel is mounted. As inline JSX it ran on every render of a closed Tool,
// and a streaming Write carries its whole file in `input`.
//
// Sits in the group under a hairline, like the row's View edge.
const ToolBody = ({ toolPart }: { toolPart: ToolPart }) => {
  const { input, output, state } = toolPart;

  return (
    <div className="whitespace-pre-wrap break-all border-t border-white/[0.06] px-2.5 py-2 font-mono text-[11px] leading-[1.6]">
      {input && (
        <div className="text-neutral-300">
          {Object.entries(input).map(([key, value]) => (
            <div key={key}>
              <span className="text-neutral-500">{key}:</span>{" "}
              {formatValue(value)}
            </div>
          ))}
        </div>
      )}

      {output && (
        <div className="mt-1 text-neutral-500">
          {Object.entries(output).map(([key, value]) => (
            <div key={key}>
              {key}: {formatValue(value)}
            </div>
          ))}
        </div>
      )}

      {state === "output-error" && toolPart.errorText && (
        <div className="mt-1 text-red-300/70">{toolPart.errorText}</div>
      )}
    </div>
  );
};

export type ToolProps = {
  toolPart: ToolPart;
  title?: string;
  defaultOpen?: boolean;
  /** Focuses the component on the canvas. Without it, no View button shows. */
  onViewComponent?: (componentName: string) => void;
  className?: string;
};

// One row of a grouped list (ToolCallsMono design): the caller's group draws
// the card and the hairlines between calls. The hover fill and colours switch
// without a transition, so hovering costs one repaint and no animation frames.
export const Tool = memo(function Tool({
  toolPart,
  title,
  defaultOpen = false,
  onViewComponent,
  className,
}: ToolProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { state } = toolPart;

  const component = onViewComponent ? viewableComponent(toolPart) : null;
  const running = state === "input-streaming" || state === "input-available";
  const failed = state === "output-error";

  return (
    <div className={className}>
      <div className="flex items-stretch">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((o) => !o)}
          className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-2 hover:bg-white/[0.025]"
        >
          <span className="grid w-4 shrink-0 place-items-center text-neutral-500">
            {running ? <Spinner /> : <Ring failed={failed} />}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left text-[13px] text-neutral-300",
              running && "tool-shimmer",
            )}
          >
            {title ?? getToolTitle(toolPart)}
          </span>
          {failed && (
            <span className="shrink-0 text-[12px] text-red-300/70">Failed</span>
          )}
          <ChevronDown
            className={cn(
              "ml-1 size-3.5 shrink-0 text-neutral-600 transition-transform group-hover:text-neutral-400",
              isOpen && "rotate-180",
            )}
          />
        </button>

        {/* Sibling of the trigger, never a child — a nested button is invalid
            and would swallow the expand click on the way out. */}
        {component && (
          <button
            type="button"
            onClick={() => onViewComponent?.(component)}
            title={`View ${component}`}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-l border-white/[0.06] px-2.5 text-[13px] font-medium text-neutral-500 hover:bg-white/[0.025] hover:text-neutral-100"
          >
            <ArrowUpRight className="size-3.5" />
            View
          </button>
        )}
      </div>

      {isOpen && <ToolBody toolPart={toolPart} />}
    </div>
  );
});
