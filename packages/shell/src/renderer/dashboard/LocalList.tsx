import { useState } from "react";
import type { WorkspaceWithThumbnail } from "@/main/api";
import { cn } from "@/renderer/lib/utils";
import { MENU, Svg, WorkspaceThumb, ic, menuItem, useOutside } from "./kit";

// The workspaces on this Mac, as rows. A click selects one; a
// double click or Enter opens it; a right click, or the row's ⋯, is its menu.

export type Sort = "active" | "created" | "name";
const SORTS: Record<Sort, string> = { active: "Last active", created: "Date created", name: "Name" };

// createdAt is a Date in main and its ISO string once it has crossed the API.
const createdAt = (w: WorkspaceWithThumbnail) => new Date(w.createdAt).getTime();

export const SORTERS: Record<Sort, (a: WorkspaceWithThumbnail, b: WorkspaceWithThumbnail) => number> = {
  active: (a, b) => b.lastActiveAt - a.lastActiveAt,
  created: (a, b) => createdAt(b) - createdAt(a),
  name: (a, b) => a.name.localeCompare(b.name),
};

export const ago = (t: number) => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "Just now";
  const steps: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [86400 * 30, "month"],
    [86400 * 365, "year"],
  ];
  let unit = steps[0]!;
  for (const step of steps) if (s >= step[0]) unit = step;
  const n = Math.floor(s / unit[0]);
  return `${n} ${unit[1]}${n === 1 ? "" : "s"} ago`;
};

const date = (t: number) => {
  const d = new Date(t);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
  });
};

/* ── Menus ────────────────────────────────────────────────────────────── */

const MENU_WIDTH = 208;

export const RowMenu = ({
  x,
  y,
  onOpen,
  onDelete,
  onClose,
}: {
  x: number;
  y: number;
  onOpen: () => void;
  // Without it, no Delete.
  onDelete?: () => void;
  onClose: () => void;
}) => {
  const ref = useOutside(true, onClose);
  const item = (label: string, fn: () => void, danger = false) => (
    <button
      onClick={() => {
        fn();
        onClose();
      }}
      className={cn(menuItem, danger ? "text-[#f08a8a]" : "text-[#E9E9E9]")}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={ref}
      className={cn("fixed z-50 w-52", MENU)}
      // Kept in the window: a right click can land at its edge.
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8)),
        top: Math.max(8, Math.min(y, window.innerHeight - 96)),
      }}
    >
      {item("Open", onOpen)}
      {onDelete && (
        <>
          <div className="my-1 h-px bg-[#373737]" />
          {item("Delete", onDelete, true)}
        </>
      )}
    </div>
  );
};

export const SortMenu = ({ sort, onSort }: { sort: Sort; onSort: (s: Sort) => void }) => {
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-[32px] items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] whitespace-nowrap text-[#B2B2B2] hover:bg-[#2A2A2A] hover:text-[#E9E9E9]"
      >
        {SORTS[sort]}
        <Svg size={13} className="text-[#9B9B9B]">
          {ic.down}
        </Svg>
      </button>
      {open && (
        <div className={cn("absolute top-[36px] right-0 z-40 w-44", MENU)}>
          {(Object.keys(SORTS) as Sort[]).map((s) => (
            <button
              key={s}
              onClick={() => {
                onSort(s);
                setOpen(false);
              }}
              className={cn(menuItem, "text-[#E9E9E9]")}
            >
              <span className="flex-1">{SORTS[s]}</span>
              {s === sort && (
                <Svg size={14} sw={2}>
                  {ic.check}
                </Svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ── List ─────────────────────────────────────────────────────────────── */

type ItemProps = {
  items: WorkspaceWithThumbnail[];
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (workspace: WorkspaceWithThumbnail) => void;
  onMenu: (workspace: WorkspaceWithThumbnail, x: number, y: number) => void;
};

const rowHandlers = (
  w: WorkspaceWithThumbnail,
  { onSelect, onOpen, onMenu }: Pick<ItemProps, "onSelect" | "onOpen" | "onMenu">,
) => ({
  role: "button",
  tabIndex: 0,
  onClick: () => onSelect(w.id),
  onDoubleClick: () => onOpen(w),
  onKeyDown: (e: React.KeyboardEvent) => {
    // Its own, not the ⋯ button's inside it.
    if (e.key === "Enter" && e.target === e.currentTarget) onOpen(w);
  },
  onContextMenu: (e: React.MouseEvent) => {
    e.preventDefault();
    onMenu(w, e.clientX, e.clientY);
  },
});

const MoreButton = ({ onClick }: { onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      onClick(e);
    }}
    onDoubleClick={(e) => e.stopPropagation()}
    aria-label="More"
    className="grid size-7 place-items-center rounded-[6px] text-[#9B9B9B] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-[#373737] hover:text-[#E9E9E9] focus-visible:opacity-100"
  >
    <Svg size={15}>{ic.more}</Svg>
  </button>
);

const COLS = "grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_40px]";

export const ListRows = ({ items, selected, ...h }: ItemProps) => (
  <div>
    {/* Stays on top of the rows as they scroll under it, as wide as they are. */}
    <div className={cn("sticky top-0 z-10 -mx-2 grid gap-4 bg-[#222222] px-2 pb-3 text-[13px] text-[#9B9B9B]", COLS)}>
      <span>Name</span>
      <span>Last active</span>
      <span>Created</span>
      <span />
    </div>
    <div className="space-y-1">
      {items.map((w) => (
        <div
          key={w.id}
          {...rowHandlers(w, h)}
          className={cn(
            // focus-visible: a row reached with Tab shows it's the one Enter opens.
            // Rings inset: drawn outside, the first row's top edge went under
            // the sticky column headings.
            "group -mx-2 grid cursor-default items-center gap-4 rounded-[10px] px-2 py-1.5 outline-none focus-visible:bg-[#262626] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#7F8BE0]/60",
            COLS,
            selected === w.id ? "bg-[#2A2A2A] ring-1 ring-inset ring-[#7F8BE0]" : "hover:bg-[#262626]",
          )}
        >
          <div className="flex min-w-0 items-center gap-4">
            <WorkspaceThumb workspace={w} className="h-[60px] w-[96px] shrink-0 rounded-[6px]" />
            <span className="truncate text-[14.5px] text-[#E9E9E9]">{w.name}</span>
          </div>
          <span className="text-[13.5px] text-[#B2B2B2]">{ago(w.lastActiveAt)}</span>
          <span className="text-[13.5px] text-[#B2B2B2]">{date(createdAt(w))}</span>
          <div className="flex justify-end">
            <MoreButton
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                h.onMenu(w, r.right - MENU_WIDTH, r.bottom + 4);
              }}
            />
          </div>
        </div>
      ))}
    </div>
  </div>
);
