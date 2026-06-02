"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/renderer/components/ui/collapsible";
import { cn } from "@/renderer/lib/utils";
import {
  IconCircleCheckFilled,
  IconCircleHalf2,
  IconCircleXFilled,
} from "@tabler/icons-react";
import { ChevronDown } from "lucide-react";
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

export type ToolProps = {
  toolPart: ToolPart;
  title?: string;
  defaultOpen?: boolean;
  className?: string;
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

/* ── Component ─────────────────────────────────────────────────────────── */

export const Tool = ({ toolPart, title, defaultOpen = false, className }: ToolProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const cfg = stateConfig[toolPart.state];
  const StateIcon = cfg.icon;

  const { input, output, state } = toolPart;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-sm border border-[#444] bg-[#333]",
        className
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-[6px] px-2.5 py-2 transition-colors hover:bg-[#3d3d3d]"
          >
            <div
              className={cn(
                "flex shrink-0 items-center",
                (toolPart.state === "input-streaming" || toolPart.state === "input-available") && "animate-spin"
              )}
            >
              <StateIcon size={18} strokeWidth={1.75} color={cfg.color} />
            </div>
            <p className="m-0 min-w-0 flex-1 truncate text-left text-[13px] font-medium text-neutral-200">
              {title ?? toolPart.type}
            </p>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-[#888] transition-transform",
                isOpen && "rotate-180"
              )}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden border-t border-[#444]">
          <div className="bg-neutral-800 p-2.5 font-mono text-[11px]">
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
                <span className="text-[#f06060]">
                  {toolPart.errorText}
                </span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
};
