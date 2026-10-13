/**
 * The right panel, docked at the canvas's right: 280px to start, wider by
 * its left edge. Two sections, Design and
 * Comments. Picking Inspect (I) opens Design and Comment (C) opens Comments;
 * a tab only changes the section, never the tool. Design's footer is the
 * canvas's edit bar (EditBar).
 */
import { useRef } from "react";
import { PanelRight, PanelRightClose } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { DesignSection } from "./sections";
import { IconButton, MONO } from "./dial";
import { useOutbox } from "./Outbox";
import { PANEL_W, useDesignStore, useTab, type Tab } from "./store";
import { useDesign } from "./use-design";

const setTab = (t: Tab) => useDesignStore.getState().setTab(t);

// Quiet tabs, as Figma's Design / Prototype and Framer's Agent / Style:
// medium, no underline; the open one sits on a faint chip that
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
            "relative flex h-6 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] font-medium",
            on ? "text-white/85" : "text-white/40 hover:text-white/65",
          )}
        >
          {on && <span className="absolute inset-0 rounded-md bg-white/[0.06]" />}
          <span className="relative">{t === "design" ? "Design" : "Comments"}</span>
          {mark && <span className="relative flex items-center">{mark}</span>}
        </button>
      );
    })}
  </div>
);

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

// The panel's left edge, dragged to widen it, as the side panel's right edge
// is (components/ui/resizable-panel). The width is written straight to the
// panel while dragging and kept when let go.
const ResizeHandle = ({ panel }: { panel: React.RefObject<HTMLElement | null> }) => {
  const handle = useRef<HTMLDivElement>(null);
  const start = () => {
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    handle.current?.classList.add("!bg-[#71717a]");
    let width = useDesignStore.getState().width;
    const move = (e: MouseEvent) => {
      if (!panel.current) return;
      const right = panel.current.getBoundingClientRect().right;
      width = Math.min(PANEL_W.max, Math.max(PANEL_W.min, right - e.clientX));
      panel.current.style.width = `${width}px`;
    };
    const up = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      handle.current?.classList.remove("!bg-[#71717a]");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      useDesignStore.getState().setWidth(width);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };
  return <div ref={handle} onMouseDown={start} className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-[#2d2d2d]" />;
};

// The panel beside the canvas.
export const RightPanel = () => {
  const panelOpen = useDesignStore((s) => s.panelOpen);
  const width = useDesignStore((s) => s.width);
  const aside = useRef<HTMLElement>(null);
  const tab = useTab();
  const d = useDesign();
  const comments = useOutbox();
  return (
    panelOpen && (
      <aside
        ref={aside}
        className="dk-root relative shrink-0 overflow-hidden border-l border-[#333] bg-[#2A2A2A] text-white"
        style={{ width }}
      >
        <ResizeHandle panel={aside} />
        <div className="flex h-full flex-col">
          {/* As the side panel's header: 13px tabs, p-2, the chrome's border. */}
          <div className="flex shrink-0 items-center justify-between border-b border-[#333] p-2">
            <Tabs tab={tab} changes={d.changes.length} drafts={comments.drafts} />
            <IconButton
              title="Hide panel"
              onClick={() => useDesignStore.getState().setPanelOpen(false)}
              className="text-white/30 hover:text-white/70"
            >
              <PanelRightClose className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          </div>
          <div className="dk-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="pb-3">{tab === "design" ? <DesignBody d={d} /> : comments.body}</div>
          </div>
          {/* Design's footer is the canvas's edit bar (EditBar). */}
          {tab === "design" ? null : comments.foot}
        </div>
      </aside>
    )
  );
};
