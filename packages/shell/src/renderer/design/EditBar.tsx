/**
 * Precise edits: the design edits' bar, at the top centre of the canvas: the
 * change list, Reset and Apply, the thing you can't miss while there are
 * edits to apply. A contextual save bar, as Shopify's "Unsaved changes ·
 * Discard · Save" and the flat pills on Runway's and Weavy's canvases: the
 * tool rail's surface and shadow (#262626, hairline), no glow or coloured
 * rim; Reset quiet grey, Apply solid in the brand's ocean blue (app icon).
 *   edits    N changes on M elements; the list under the count, each with
 *            its own undo; Reset; Apply (to the open chat)
 *   applied  each set sent, "applying N changes…" until its chat's turn
 *            ends; × stops previewing it. Edits and sets can be there at
 *            once: Apply takes the edits off the list.
 *   missing  edits whose element the frame can't find any more (an edit to
 *            the code took it away), or whose frame is gone: said once, with
 *            Remove them, and "Not on the page" on their rows. Apply still
 *            sends them.
 * Up while Inspect is on, or while there are edits or sets. With none yet it
 * says so, and Reset and Apply wait.
 */
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, ChevronDown, SquareDashedMousePointer, X } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useCanvasTool } from "@/renderer/comments/store";
import { changesOf } from "@/shared/design";
import { MONO } from "./dial";
import { useDesign, useNotShowing, type ElementChange } from "./use-design";

const OCEAN = "#236CB6"; // app icon, deep blue
// The tool rail's (components/CanvasToolbar).
const RAIL = { background: "#262626", boxShadow: "0 4px 16px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06)" };

const ChangeList = ({ changes, gone, revert }: { changes: ElementChange[]; gone: Set<number>; revert: (c: ElementChange) => void }) => {
  const byEl = [...new Set(changes.map((c) => c.edit))].map((edit) => [edit, changes.filter((c) => c.edit === edit)] as const);
  return (
    <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto p-1.5">
      {byEl.map(([edit, cs]) => (
        <div key={edit.id} className="flex flex-col">
          <span className="flex items-center gap-1.5 px-2 py-0.5">
            <span className={cn(MONO, "min-w-0 truncate text-[11px] text-white/40")} title={`${edit.componentName} · ${edit.name}`}>
              {edit.name}
            </span>
            {gone.has(edit.id) && <span className="shrink-0 text-[11px] text-[#fbbf24]/80">Not on the page</span>}
          </span>
          {cs.map((c) => (
            <div key={c.group.key} className="group flex h-7 items-center gap-2 rounded-md px-2 hover:bg-white/[0.05]">
              <span className="shrink-0 text-[12.5px] font-medium text-white/75">{c.group.label}</span>
              <span className={cn(MONO, "min-w-0 flex-1 truncate text-right text-[11.5px] text-white/45")} title={`${c.from} → ${c.to}`}>
                {c.from} → <span className="text-white/85">{c.to}</span>
              </span>
              <button
                type="button"
                aria-label={`Undo ${c.group.label}`}
                title="Undo this change"
                onClick={() => revert(c)}
                className="grid size-5 shrink-0 cursor-pointer place-items-center rounded opacity-0 hover:bg-white/10 text-white/50 group-hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};

const Spin = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" className="shrink-0 animate-spin text-white/60" style={{ animationDuration: "1.1s" }}>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const enter = {
  initial: { opacity: 0, y: -10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { type: "spring" as const, visualDuration: 0.3, bounce: 0.15 },
};

const countOf = (changes: ElementChange[], edits: ElementChange["edit"][]) => changes.filter((c) => edits.includes(c.edit)).length;

// "2 changes aren't showing: their element is no longer in Card."
const notShowing = (n: number, components: string[]) =>
  `${n} ${n === 1 ? "change isn't" : "changes aren't"} showing: ${n === 1 ? "its" : "their"} element is no longer in ${
    components.length === 1 ? components[0] : components.length === 2 ? components.join(" or ") : "its component"
  }.`;

export const EditBar = () => {
  const d = useDesign();
  const tool = useCanvasTool();
  const n = d.changes.length;
  const elements = d.edits.length;
  const gone = useNotShowing(d.edits);
  const goneChanges = countOf(d.changes, gone);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!n) setOpen(false);
  }, [n]);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("pointerdown", down);
    return () => window.removeEventListener("pointerdown", down);
  }, [open]);

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="pointer-events-none absolute left-1/2 top-3 z-40 flex -translate-x-1/2 flex-col items-center gap-1.5 text-white"
    >
      <AnimatePresence initial={false}>
        {(n > 0 || tool === "inspect") && (
          <motion.div key="edits" {...enter} className="pointer-events-auto relative">
            <div className="flex h-10 items-center gap-1 rounded-[12px] p-1 pl-3" style={RAIL}>
              <SquareDashedMousePointer className="size-4 shrink-0 text-white/55" strokeWidth={1.75} />
              {/* The mode's name: what Inspect is for. */}
              <span className="ml-2 whitespace-nowrap text-[13px] font-medium text-white/90">Precise edits</span>
              <span className="ml-1.5 h-4 w-px bg-white/10" />
              {n === 0 ? (
                <span className="ml-0.5 whitespace-nowrap px-2 text-[13px] text-white/45">No changes yet</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(!open)}
                  aria-expanded={open}
                  title="See the changes"
                  className={cn(
                    "ml-0.5 flex h-8 cursor-pointer items-center gap-1 whitespace-nowrap rounded-[8px] px-2 text-[13px] text-white/85 transition-colors hover:bg-white/[0.06]",
                    open && "bg-white/[0.06]",
                  )}
                >
                  <span>
                    <span className={cn(MONO, "text-[12.5px]")}>{n}</span> unsaved {n === 1 ? "change" : "changes"}
                    {elements > 1 && <span className="text-white/45"> on {elements} elements</span>}
                  </span>
                  <ChevronDown className={cn("size-3.5 text-white/45 transition-transform", open && "rotate-180")} />
                </button>
              )}
              <span className="w-3" />
              <button
                type="button"
                onClick={d.reset}
                disabled={n === 0}
                title="Undo every change"
                className="flex h-8 cursor-pointer items-center rounded-[8px] bg-white/[0.07] px-3 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.11] hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white/[0.07]"
              >
                Reset
              </button>
              {/* Why there's an Apply at all: in a design tool a change is the
                  save; here it's a preview until the agent writes it. Hovering
                  says so (on the wrapper, so a disabled button still tells). */}
              <span className="group/apply relative">
                <button
                  type="button"
                  onClick={() => void d.apply()}
                  disabled={n === 0 || d.applying}
                  aria-describedby="apply-why"
                  className="flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 text-[13px] font-medium text-white transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:cursor-default disabled:opacity-40 disabled:hover:brightness-100"
                  style={{ background: OCEAN }}
                >
                  Apply to code
                  <ArrowUp className="size-3.5" />
                </button>
                <span
                  id="apply-why"
                  role="tooltip"
                  className="pointer-events-none absolute right-0 top-[calc(100%+10px)] z-20 w-[248px] translate-y-1 rounded-[10px] px-3 py-2.5 text-[12px] leading-[17px] text-white/70 opacity-0 transition-[opacity,transform] delay-0 duration-150 group-hover/apply:translate-y-0 group-hover/apply:opacity-100 group-hover/apply:delay-300"
                  style={RAIL}
                >
                  <span className="mb-1 block text-[12.5px] font-medium text-white/90">Your edits are a preview</span>
                  Nothing in your code has changed yet. Apply sends these changes to the agent, which writes them into the component.
                </span>
              </span>
            </div>
            <AnimatePresence>
              {open && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                  className="absolute left-0 right-0 top-[calc(100%+6px)] z-10 min-w-[300px] origin-top rounded-[12px]"
                  style={RAIL}
                >
                  <ChangeList changes={d.changes} gone={new Set(gone.map((e) => e.id))} revert={d.revert} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
        {goneChanges > 0 && !open && (
          <motion.div
            key="missing"
            {...enter}
            className="pointer-events-auto flex h-9 items-center gap-2.5 rounded-[10px] pl-3 pr-1.5 text-[12.5px] text-white/75"
            style={RAIL}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-[#fbbf24]/80" />
            <span className="whitespace-nowrap">{notShowing(goneChanges, [...new Set(gone.map((e) => e.componentName))])}</span>
            <button
              type="button"
              onClick={() => d.revertEdits(gone)}
              title="Undo the changes that aren't showing"
              className="flex h-6 shrink-0 cursor-pointer items-center rounded-md bg-white/[0.07] px-2 text-[11.5px] font-medium text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white"
            >
              {goneChanges === 1 ? "Remove it" : "Remove them"}
            </button>
          </motion.div>
        )}
        {d.applied.map((a) => {
          const count = a.edits.reduce((sum, e) => sum + changesOf(e.base, e.now).length, 0);
          const els = a.edits.length;
          return (
            <motion.div
              key={a.id}
              {...enter}
              className="pointer-events-auto flex h-9 items-center gap-2.5 rounded-[10px] pl-3 pr-1.5 text-[12.5px] text-white/75"
              style={RAIL}
            >
              <Spin />
              <span className="whitespace-nowrap">
                The agent is applying {count} {count === 1 ? "change" : "changes"}
                {els > 1 && <span className="text-white/45"> on {els} elements</span>}…
              </span>
              {/* Not before the API has the set: only its number can let it go. */}
              <button
                type="button"
                onClick={() => d.release(a.id)}
                disabled={a.id < 0}
                title="Stop previewing them"
                aria-label="Stop previewing them"
                className="grid size-6 cursor-pointer place-items-center rounded-md text-white/45 hover:bg-white/[0.08] hover:text-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
