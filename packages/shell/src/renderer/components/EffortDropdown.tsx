import { useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Gauge } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/renderer/components/ui/popover";
import {
  Command,
  CommandItem,
  CommandList,
} from "@/renderer/components/ui/command";
import { cn } from "@/renderer/lib/utils";
import {
  clampEffort,
  DEFAULT_EFFORT,
  EFFORT_META,
  EFFORT_ORDER,
  effortRank,
  orderEfforts,
  type EffortLevel,
} from "./effortShared";

type Props = {
  levels?: EffortLevel[];
  value?: EffortLevel;
  defaultValue?: EffortLevel;
  onChange?: (level: EffortLevel) => void;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  className?: string;
};

// Tiny ascending-bar glyph so each row carries an ordinal cue.
const MiniBars = ({ level }: { level: EffortLevel }) => {
  const rank = effortRank(level);
  return (
    <span className="flex h-3.5 items-end gap-[2px]">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{ height: `${4 + i * 2.4}px` }}
          className={cn(
            "w-[3px] rounded-[1px]",
            i <= rank ? "bg-neutral-200" : "bg-white/20"
          )}
        />
      ))}
    </span>
  );
};

/**
 * Effort picker dropdown — an antidraw-styled popover (same surface as the
 * model picker). Each level shows its label, a one-line description, and a mini
 * bar glyph; the active level gets a check.
 */
export default function EffortDropdown({
  levels = EFFORT_ORDER,
  value,
  defaultValue,
  onChange,
  disabled = false,
  align = "start",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const commandRef = useRef<HTMLDivElement>(null);
  const ordered = orderEfforts(levels);
  const [internal, setInternal] = useState(
    clampEffort(defaultValue ?? DEFAULT_EFFORT, ordered)
  );
  const selected = value ?? internal;

  const select = (level: EffortLevel) => {
    if (value === undefined) setInternal(level);
    onChange?.(level);
    setOpen(false);
  };

  if (!ordered.length || !selected) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border-none bg-white/[0.06] px-2.5 py-1 text-sm font-medium text-neutral-200 transition-colors hover:bg-white/[0.10] disabled:pointer-events-none disabled:opacity-50",
            className
          )}
        >
          <Gauge className="h-3.5 w-3.5 shrink-0 text-neutral-400" />
          <span className="truncate">{EFFORT_META[selected].label}</span>
          {open ? (
            <ChevronUp className="h-3 w-3 shrink-0 text-neutral-500" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0 text-neutral-500" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={8}
        onClick={(e) => e.stopPropagation()}
        // Keep Radix from auto-focusing the first focusable, but move focus
        // onto the cmdk root so arrow keys / Enter / typeahead reach it.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          commandRef.current?.focus();
        }}
        // `outline-none` (here and on descendants) suppresses the browser's
        // white focus-visible ring now that focus moves into the menu for
        // keyboard navigation.
        className="dark w-[240px] overflow-hidden rounded-lg border border-[#2d2d2d] bg-[#2c2c2c] p-1.5 shadow-lg outline-none **:outline-none"
      >
        <Command
          ref={commandRef}
          tabIndex={-1}
          defaultValue={selected}
          className="outline-none"
        >
          <CommandList className="[&_[cmdk-list-sizer]]:space-y-0.5">
            {ordered.map((level) => {
              const active = level === selected;
              return (
                <CommandItem
                  key={level}
                  value={level}
                  keywords={[EFFORT_META[level].label]}
                  onSelect={() => select(level)}
                  className="group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left"
                >
                  <MiniBars level={level} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium leading-tight text-neutral-200">
                      {EFFORT_META[level].label}
                    </span>
                    <span className="text-xs leading-snug text-neutral-400 group-data-[selected=true]:text-neutral-300">
                      {EFFORT_META[level].description}
                    </span>
                  </div>
                  {active && (
                    <Check className="h-3 w-3 shrink-0 text-neutral-300" />
                  )}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
