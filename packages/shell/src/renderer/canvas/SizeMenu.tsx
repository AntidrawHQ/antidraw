import { useId, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { ArrowLeftRight, Check, ChevronDown, Proportions } from "lucide-react";
import { Listbox, ListboxItem } from "@ui-sdk/react/listbox";
import { NumberInput, NumberInputControl, NumberInputGroup, NumberInputScrubArea } from "@ui-sdk/react/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@ui-sdk/react/popover";
import { ToolbarButton } from "@ui-sdk/react/toolbar";
import { cn } from "@/renderer/lib/utils";
import { MIN_SIZE, PRESETS, presetAt, type FrameSize } from "./frame-size";

// A frame's size, in its toolbar (PillToggleToolbar). The button names the
// frame's size (Tablet), and its menu lists the presets with a check at the
// right edge for the one the frame is. Custom isn't something to pick: it's
// checked whenever the size is no preset's, and clicking it puts the cursor
// in W. A swap button between W and H turns the frame on its side. A preset
// sets both the width and the height; clearing H lets the height hug the
// content (Auto), which is a custom size.
//
// Arrow keys in the list only move the highlight: Enter, Space or a click
// picks the size, so the frame resizes once, not at every row on the way.

// The toolbar's buttons. Must sit in the toolbar's (@ui-sdk) Toolbar.
export const toolButton =
  "flex items-center justify-center gap-[5px] h-[26px] rounded-md text-xs font-medium text-white/50 outline-none transition-colors hover:text-white/70 hover:bg-white/[0.06] focus-visible:text-white/80 focus-visible:ring-1 focus-visible:ring-[#E8E8E8]";

// A W or H field, styled as the Design panel's number field. What's typed
// reaches the frame on Enter or on leaving the field, so typing 1280 doesn't
// run the frame through 12 and 128 on the way, and Esc drops it. Steps and
// scrubs apply as they happen; from an empty field they start at
// `whenEmpty`, not the minimum. Home and End move the cursor, as in any
// text field, and don't set the size to the minimum (a spinbutton's own).
const SizeField = ({
  axis,
  id,
  value,
  placeholder,
  autoFocus,
  whenEmpty,
  onChange,
}: {
  axis: "W" | "H";
  id?: string;
  value: number | null;
  placeholder?: string;
  autoFocus?: boolean;
  whenEmpty?: () => number;
  onChange: (n: number | null) => void;
}) => {
  // undefined: nothing is being typed, and the field shows the frame's size.
  const [typed, setTyped] = useState<number | null | undefined>(undefined);
  const shown = typed === undefined ? value : typed;
  const apply = (n: number | null) => {
    setTyped(undefined);
    onChange(n);
  };
  // Esc was pressed: what's typed isn't applied as the field loses the focus
  // (the menu closing), which commits it.
  const dropped = useRef(false);
  const ownKeys = (e: KeyboardEvent) => {
    if (e.key === "Home" || e.key === "End") e.stopPropagation();
    if (e.key === "Escape") {
      dropped.current = true;
      setTyped(undefined);
    }
  };
  return (
    <NumberInput
      value={shown}
      onValueChange={(n, details) => {
        if (details.reason === "input-change") setTyped(n);
        else if (shown === null && n !== null && whenEmpty && details.reason !== "input-commit") apply(whenEmpty());
        else apply(n);
      }}
      onValueCommit={(n) => {
        if (dropped.current) dropped.current = false;
        else apply(n);
      }}
      min={MIN_SIZE}
      step={1}
      largeStep={10}
      format={{ useGrouping: false }}
    >
      <NumberInputGroup
        // Ahead of the field's own key handling.
        onKeyDownCapture={ownKeys}
        className="flex items-center h-7 w-[62px] rounded-[6px] bg-[#373737] hover:bg-[#404040] ring-1 ring-inset ring-transparent focus-within:ring-[#E8E8E8] text-[12px]">
        <NumberInputScrubArea
          pixelsPerStep={1}
          className="self-stretch grid place-items-center min-w-5 pl-1.5 pr-1 text-[11px] text-[#A3A3A3] hover:text-[#F2F2F2] cursor-ew-resize select-none touch-none"
        >
          <span aria-hidden="true">{axis}</span>
        </NumberInputScrubArea>
        <NumberInputControl
          id={id}
          aria-label={axis === "W" ? "Width" : "Height"}
          placeholder={placeholder}
          data-autofocus={autoFocus || undefined}
          onFocus={(e) => {
            dropped.current = false;
            e.currentTarget.select();
          }}
          onBlur={() => setTyped(undefined)}
          className="w-full min-w-0 pr-1.5 bg-transparent dk-mono tabular-nums text-[#F2F2F2] placeholder:text-[#A3A3A3] outline-none"
        />
      </NumberInputGroup>
    </NumberInput>
  );
};

// One row of the menu. The check at the right edge is the only thing that says
// which size the frame is; the fill and ring say where the keyboard is, which
// can be another row until Enter picks it.
const row = "flex items-center gap-2 h-9 px-2 rounded-lg cursor-default hover:bg-white/[0.06]";
const presetRow = cn(
  row,
  "group outline-none data-highlighted:bg-white/[0.06] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#E8E8E8]",
);

// Arrow keys typed in a W/H field are the field's: they don't reach the
// toolbar the menu opened from.
const keepArrows = (e: KeyboardEvent) => {
  if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") e.stopPropagation();
};

export const SizeMenu = ({
  size,
  onSizeChange,
  huggedHeight,
  Covers,
}: {
  size: FrameSize;
  // Called with how to change the frame's size as it is when applied, so
  // quick steps and scrubs build on each other.
  onSizeChange: (update: (size: FrameSize) => FrameSize) => void;
  // The height the frame hugs to right now, for the first step out of Auto.
  huggedHeight: () => number;
  // Rendered while the menu is open: the host's word that something covers
  // the canvas.
  Covers?: ComponentType;
}) => {
  const [open, setOpen] = useState(false);
  const widthId = useId();

  const at = presetAt(size);
  const TriggerIcon = at ? at.preset.Icon : Proportions;
  const dims = `${size.w} × ${size.h ?? "Auto"}`;

  // Turns the frame on its side. An Auto height has nothing to swap with.
  const swap = () => onSizeChange((s) => (s.h === null ? s : { w: s.h, h: s.w }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ToolbarButton
        render={<PopoverTrigger />}
        aria-label={`Frame size: ${at ? at.preset.label : "Custom"}, ${dims}`}
        title={dims}
        className={cn(
          toolButton,
          "gap-1.5 pl-2 pr-1.5 whitespace-nowrap data-open:bg-white/[0.1] data-open:text-white",
        )}
      >
        <TriggerIcon size={14} aria-hidden="true" className={cn("transition-transform", at?.turned && "rotate-90")} />
        {at ? at.preset.label : "Custom"}
        <ChevronDown size={12} aria-hidden="true" className="text-white/40" />
      </ToolbarButton>
      <PopoverContent
        aria-label="Frame size"
        side="bottom"
        align="start"
        sideOffset={10}
        initialFocus="[data-autofocus]"
        // In <body>, not in the toolbar (inside the canvas): the keys pressed
        // in it are the menu's, not the canvas's (the shell's tools take keys
        // pressed on the canvas), and it doesn't take the toolbar's styles.
        container={document.body}
        // nokey: as the toolbar's (Canvas's FrameToolbar): React Flow's node
        // gets the menu's keys through React's tree all the same.
        className="nokey w-[276px] p-1 rounded-xl bg-[#262626] text-white font-normal shadow-[0_12px_32px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.07)] origin-(--transform-origin) transition-[opacity,scale] duration-150 data-starting-style:opacity-0 data-starting-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:scale-[0.98] motion-reduce:transition-none"
      >
        <Listbox
          aria-label="Presets"
          activation="manual"
          value={at ? at.preset.id : null}
          onValueChange={(id) => {
            const preset = PRESETS.find((p) => p.id === id);
            if (preset) onSizeChange(() => ({ w: preset.w, h: preset.h }));
          }}
          className="flex flex-col"
        >
          {PRESETS.map((p) => {
            const checked = at?.preset.id === p.id;
            const turned = checked && at.turned;
            return (
              <ListboxItem
                key={p.id}
                value={p.id}
                label={p.label}
                data-autofocus={checked || undefined}
                className={presetRow}
              >
                <p.Icon
                  size={14}
                  aria-hidden="true"
                  className={cn("text-white/55 transition-transform", turned && "rotate-90")}
                />
                <span className="text-xs text-white/85">{p.label}</span>
                <span className="ml-auto dk-mono text-[11px] tabular-nums text-white/50">
                  {turned ? `${p.h} × ${p.w}` : `${p.w} × ${p.h}`}
                </span>
                <Check
                  size={12}
                  aria-hidden="true"
                  className="shrink-0 text-white opacity-0 group-data-selected:opacity-100"
                />
              </ListboxItem>
            );
          })}
        </Listbox>
        <div className="h-px bg-white/[0.06] my-1 mx-1" />
        <div className="flex items-center gap-2 pr-2">
          <label htmlFor={widthId} className={cn(row, "flex-1")}>
            <Proportions size={14} aria-hidden="true" className="text-white/55" />
            <span className="text-xs text-white/85">Custom</span>
          </label>
          <div role="group" aria-label="Custom size" className="flex items-center gap-0.5" onKeyDown={keepArrows}>
            <SizeField
              axis="W"
              id={widthId}
              value={size.w}
              autoFocus={!at}
              whenEmpty={() => size.w}
              onChange={(n) => n !== null && onSizeChange((s) => ({ ...s, w: n }))}
            />
            <button
              type="button"
              aria-label="Swap width and height"
              title="Swap width and height"
              disabled={size.h === null}
              onClick={swap}
              className="grid place-items-center h-7 w-5 rounded-[5px] text-[#A3A3A3] outline-none transition-colors hover:text-[#F2F2F2] hover:bg-white/[0.06] focus-visible:text-[#F2F2F2] focus-visible:ring-1 focus-visible:ring-[#E8E8E8] disabled:opacity-35 disabled:pointer-events-none"
            >
              <ArrowLeftRight size={12} aria-hidden="true" />
            </button>
            <SizeField
              axis="H"
              value={size.h}
              placeholder="Auto"
              whenEmpty={huggedHeight}
              onChange={(n) => onSizeChange((s) => ({ ...s, h: n }))}
            />
          </div>
          <Check
            size={12}
            aria-hidden="true"
            data-custom-check=""
            className={cn("shrink-0 text-white", at && "opacity-0")}
          />
        </div>
        {Covers && <Covers />}
      </PopoverContent>
    </Popover>
  );
};
