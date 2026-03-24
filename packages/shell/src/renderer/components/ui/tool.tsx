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

/* ── Title logic ───────────────────────────────────────────────────────── */

const componentVerbMap = { Write: "Crafting", Edit: "Refining" } satisfies Record<string, string>;

const getToolTitle = (toolPart: ToolPart): string => {
  const { type, input } = toolPart;

  const desc = input?.description;
  if (typeof desc === "string" && desc) return desc;

  const fp = input?.file_path;
  if (typeof fp === "string" && fp) {
    const name = fp.split("/").pop() ?? fp;
    if (fp.includes("/user-components/")) {
      const comp = name.replace(/\.\w+$/, "");
      return `${componentVerbMap[type as keyof typeof componentVerbMap] ?? type} ${comp}`;
    }
    return `${type} ${name}`;
  }

  const pat = input?.pattern;
  if (typeof pat === "string" && pat) return `${type} ${pat}`;

  return type;
};

/* ── Colors ────────────────────────────────────────────────────────────── */

const C = {
  toolBg: "#333333",
  toolBorder: "#444444",
  toolHover: "#3d3d3d",
  toolText: "#e5e5e5",
  contentBg: "#262626",
  keyColor: "#737373",
  valueColor: "#e5e5e5",
  errorColor: "#f06060",
  chevronColor: "#888",
};

/* ── Component ─────────────────────────────────────────────────────────── */

export const Tool = ({ toolPart, defaultOpen = false, className }: ToolProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const cfg = stateConfig[toolPart.state];
  const StateIcon = cfg.icon;

  const { input, output, state } = toolPart;

  const formatValue = (value: unknown): string => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (typeof value === "string") return value;
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  };

  return (
    <div
      className={cn("overflow-hidden rounded-lg", className)}
      style={{ backgroundColor: C.toolBg, border: `1px solid ${C.toolBorder}` }}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-[6px] transition-colors"
            style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 8, paddingBottom: 8 }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = C.toolHover)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <div
              className={cn(
                "flex shrink-0 items-center",
                toolPart.state === "input-streaming" && "animate-spin"
              )}
            >
              <StateIcon size={18} strokeWidth={1.75} color={cfg.color} />
            </div>
            <p
              className="m-0 min-w-0 flex-1 truncate text-left text-[13px] font-medium"
              style={{ color: C.toolText }}
            >
              {getToolTitle(toolPart)}
            </p>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                isOpen && "rotate-180"
              )}
              style={{ color: C.chevronColor }}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent
          className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden"
          style={{ borderTop: `1px solid ${C.toolBorder}` }}
        >
          <div
            className="p-2.5 font-mono text-[11px]"
            style={{ backgroundColor: C.contentBg }}
          >
            {input &&
              Object.entries(input).map(([key, value]) => (
                <div key={key}>
                  <span style={{ color: C.keyColor }}>{key}:</span>{" "}
                  <span style={{ color: C.valueColor }}>
                    {formatValue(value)}
                  </span>
                </div>
              ))}

            {output &&
              Object.entries(output).map(([key, value]) => (
                <div key={key}>
                  <span style={{ color: C.keyColor }}>{key}:</span>{" "}
                  <span style={{ color: C.valueColor }}>
                    {formatValue(value)}
                  </span>
                </div>
              ))}

            {state === "output-error" && toolPart.errorText && (
              <div>
                <span style={{ color: C.keyColor }}>error:</span>{" "}
                <span style={{ color: C.errorColor }}>
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
