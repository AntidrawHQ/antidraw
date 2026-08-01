import { useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import ClaudeIcon from "./ClaudeIcon";
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
  DEFAULT_MODELS,
  matchesModel,
  type ModelInfo,
} from "./modelPickerShared";

export { DEFAULT_MODELS };
export type { ModelInfo };

type ModelPickerProps = {
  models?: ModelInfo[];
  /** Controlled selected model id (matched against `value` or `resolvedModel`). */
  value?: string;
  /** Uncontrolled initial model id (defaults to the first model). */
  defaultValue?: string;
  onChange?: (value: string, model: ModelInfo) => void;
  disabled?: boolean;
  className?: string;
  /** Overrides the dropdown surface (bg/border). */
  menuClassName?: string;
  /** Popover alignment against the trigger. */
  align?: "start" | "center" | "end";
};

export default function ModelPicker({
  models = DEFAULT_MODELS,
  value,
  defaultValue,
  onChange,
  disabled = false,
  className,
  menuClassName,
  align = "start",
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const commandRef = useRef<HTMLDivElement>(null);
  const [internalValue, setInternalValue] = useState(
    defaultValue ?? models[0]?.value
  );

  const selectedId = value ?? internalValue;
  const selected = models.find((m) => matchesModel(m, selectedId)) ?? models[0];

  const handleSelect = (model: ModelInfo) => {
    if (value === undefined) setInternalValue(model.value);
    onChange?.(model.value, model);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button
          type="button"
          // Keeps its own click from bubbling to the composer's focus handler.
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "flex min-w-0 max-w-[200px] items-center gap-2 rounded-lg border-none bg-white/[0.06] px-2.5 py-1 text-sm font-medium text-neutral-200 transition-colors hover:bg-white/[0.10] disabled:pointer-events-none disabled:opacity-50",
            className
          )}
        >
          <ClaudeIcon size={14} className="shrink-0 text-[#d97757]" />
          <span className="flex-1 truncate text-left">
            {selected?.resolvedModel ?? selected?.value ?? "Select model"}
          </span>
          {open ? (
            <ChevronUp className="h-3 w-3 shrink-0 text-neutral-500" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0 text-neutral-500" />
          )}
        </button>
      </PopoverTrigger>

      {/* antidraw WorkspaceSwitcher menu surface: #2c2c2c card, #2d2d2d border,
          rounded-lg, shadow-lg. Scoped `dark` + explicit colors so it holds up
          once portaled out of the composer's dark wrapper. */}
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
        className={cn(
          // `outline-none` (here and on descendants) suppresses the browser's
          // white focus-visible ring now that focus moves into the menu for
          // keyboard navigation.
          "dark w-[280px] overflow-hidden rounded-lg border border-[#2d2d2d] bg-[#2c2c2c] p-1.5 shadow-lg outline-none **:outline-none",
          menuClassName
        )}
      >
        <Command
          ref={commandRef}
          tabIndex={-1}
          defaultValue={selected?.value}
          className="outline-none"
        >
          <CommandList className="max-h-[340px] [&_[cmdk-list-sizer]]:space-y-0.5">
            {models.map((model) => {
              const isActive = matchesModel(model, selectedId);
              return (
                <CommandItem
                  key={model.value}
                  value={model.value}
                  keywords={[model.displayName]}
                  onSelect={() => handleSelect(model)}
                  className="group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left"
                >
                  <ClaudeIcon
                    size={14}
                    className="mt-0.5 shrink-0 text-[#d97757]"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm font-medium leading-tight text-neutral-200">
                      {model.displayName}
                    </span>
                    <span className="text-xs leading-snug text-neutral-400 group-data-[selected=true]:text-neutral-300">
                      {model.description}
                    </span>
                  </div>
                  {isActive && (
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-neutral-300" />
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
