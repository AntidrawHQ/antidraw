/**
 * The right panel, docked at the canvas's right: 256px, DialKit's controls
 * at 30px rows. Two sections, Design and Comments, and the canvas tool picks
 * which: Inspect (I) → Design, Comment (C) → Comments, Pointer (V) keeps the
 * last; clicking a tab picks its tool. Design's footer is the canvas's edit
 * bar (EditBar).
 */
import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "motion/react";
import { PanelRight, PanelRightClose } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { setCanvasTool, useCanvasTool } from "@/renderer/comments/store";
import { DesignSection, Kbd } from "./sections";
import { IconButton, MONO } from "./dial";
import { useOutbox } from "./Outbox";
import { useDesignStore, useTab, type Tab } from "./store";
import { useDesign } from "./use-design";

const W = 256;

const setTab = (t: Tab) => setCanvasTool(t === "design" ? "inspect" : "comment");

// Quiet tabs, as Figma's Design / Prototype and Framer's Agent / Style:
// 12px medium, no underline; the open one sits on a faint chip that
// slides between them, the other reads dim.
const Tabs = ({ tab, changes, drafts }: { tab: Tab; changes: number; drafts: number }) => (
  <div className="flex items-center gap-0.5">
    {(["design", "comments"] as Tab[]).map((t) => {
      const on = tab === t;
      const mark =
        t === "design"
          ? changes > 0 && <span className="size-1 rounded-full bg-[#60a5fa]/80" />
          : drafts > 0 && <span className={cn(MONO, "text-[11px] text-white/30")}>{drafts}</span>;
      return (
        <button
          key={t}
          type="button"
          title={t === "design" ? "Design (I)" : "Comments (C)"}
          onClick={() => setTab(t)}
          className={cn(
            "relative flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[12px] font-medium transition-colors",
            on ? "text-white/85" : "text-white/40 hover:text-white/65",
          )}
        >
          {on && (
            <motion.span
              layoutId="dense-chip"
              transition={{ type: "spring", visualDuration: 0.22, bounce: 0.1 }}
              className="absolute inset-0 rounded-md bg-white/[0.06]"
            />
          )}
          <span className="relative">{t === "design" ? "Design" : "Comments"}</span>
          {mark && <span className="relative flex items-center">{mark}</span>}
        </button>
      );
    })}
  </div>
);

// "Inspect is off" while Pointer keeps a section open.
const OffNotice = ({ tab }: { tab: Tab }) =>
  useCanvasTool() === "pointer" ? (
    <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2 text-[12px] text-white/45">
      {tab === "design" ? "Inspect is off." : "Comment is off."}
      <button type="button" onClick={() => setTab(tab)} className="flex cursor-pointer items-center gap-1 font-medium text-white/70 hover:text-white">
        Turn it on <Kbd>{tab === "design" ? "I" : "C"}</Kbd>
      </button>
    </div>
  ) : null;

const DesignBody = ({ d }: { d: ReturnType<typeof useDesign> }) => (
  <DesignSection
    selected={d.key}
    s={d.current?.now ?? null}
    base={d.current?.base ?? null}
    text={d.current?.text ?? false}
    set={d.set}
    size={d.selection ? { w: d.selection.info.rect.width, h: d.selection.info.rect.height } : { w: 0, h: 0 }}
  />
);

const floatShadow = { boxShadow: "0 4px 16px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06)" };

// The panel hidden, its button at the canvas's top right. Mounted over the
// canvas.
export const ShowPanel = () => {
  const panelOpen = useDesignStore((s) => s.panelOpen);
  return panelOpen ? null : (
    <button
      type="button"
      title="Show panel"
      onClick={(e) => {
        e.stopPropagation();
        useDesignStore.getState().setPanelOpen(true);
      }}
      className="absolute right-4 top-4 z-30 grid size-8 place-items-center rounded-[10px] bg-[#262626] text-white/60 hover:text-white/95"
      style={floatShadow}
    >
      <PanelRight className="size-4" strokeWidth={1.75} />
    </button>
  );
};

// The panel beside the canvas.
export const RightPanel = () => {
  const panelOpen = useDesignStore((s) => s.panelOpen);
  const tab = useTab();
  const d = useDesign();
  const comments = useOutbox();
  return (
    <AnimatePresence initial={false}>
      {panelOpen && (
        <motion.aside
          initial={{ width: 0 }}
          animate={{ width: W }}
          exit={{ width: 0 }}
          transition={{ type: "spring", visualDuration: 0.3, bounce: 0 }}
          className="dk-root shrink-0 overflow-hidden border-l border-[#333] bg-[#2A2A2A] text-white"
          style={{ "--dk-row": "30px" } as CSSProperties}
        >
          <div className="flex h-full flex-col" style={{ width: W }}>
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/[0.05] pl-2 pr-1.5">
              <Tabs tab={tab} changes={d.changes.length} drafts={comments.drafts} />
              <IconButton title="Hide panel" onClick={() => useDesignStore.getState().setPanelOpen(false)} className="text-white/30 hover:text-white/70">
                <PanelRightClose className="size-3.5" strokeWidth={1.75} />
              </IconButton>
            </div>
            <OffNotice tab={tab} />
            <div className="dk-scroll min-h-0 flex-1 overflow-y-auto">
              {/* The open section, sliding in from its tab's side. */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, x: tab === "design" ? -8 : 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: tab === "design" ? -8 : 8 }}
                  transition={{ duration: 0.14, ease: "easeOut" }}
                  className="pb-3"
                >
                  {tab === "design" ? <DesignBody d={d} /> : comments.body}
                </motion.div>
              </AnimatePresence>
            </div>
            {/* Design's footer is the canvas's edit bar (EditBar). */}
            {tab === "design" ? null : comments.foot}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
