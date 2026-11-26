import type { KeyboardEvent, ReactNode } from "react";
import { ContextMenu, DropdownMenu } from "radix-ui";
import type { WorkspaceWithThumbnail } from "@/main/api";
import { cn } from "@/renderer/lib/utils";
import { MENU, Svg, WorkspaceThumb, ic, menuItem } from "./kit";

// The workspaces on this Mac, as rows. A click selects one; a
// double click or Enter opens it; a right click, or the row's ⋯, is its menu.
//
// From the keyboard: the list is one stop for Tab, and ↑ ↓ Home End move
// through it; Tab from a row goes to its ⋯. The menus are Radix's, so the
// arrows, a typed letter, Enter and Esc work in them as in any menu.

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

// A row of a Radix menu: lit by the pointer or the arrow keys alike.
const ITEM = cn(menuItem, "cursor-default text-[#E9E9E9] outline-none select-none data-[highlighted]:bg-[#373737]");
const DANGER = "text-[#f08a8a]";

export const SortMenu = ({
  sort,
  onSort,
  className,
  onCloseAutoFocus,
}: {
  sort: Sort;
  onSort: (s: Sort) => void;
  // For the button, where it's put somewhere tighter than the dashboard's header.
  className?: string;
  // Where the focus goes as the menu closes, when that isn't back to the button.
  onCloseAutoFocus?: (e: Event) => void;
}) => (
  <DropdownMenu.Root>
    {/* As wide as what it says, right beside the search: the search moves over when the order's name is longer or shorter. */}
    <DropdownMenu.Trigger
      aria-label={`Sort by: ${SORTS[sort]}`}
      className={cn(
        // No fill of its own: one comes with the pointer, the keys, and while its menu is open.
        // -mr-2: with no fill, its padding is only space. The chevron ends where the rule under it
        // does, and the fill, when it comes, runs as far out as a row's.
        "-mr-2 flex h-[32px] shrink-0 items-center gap-2 rounded-[8px] px-2 text-[13px] whitespace-nowrap text-[#B2B2B2] outline-none",
        "hover:bg-[#313131] hover:text-[#E9E9E9] focus-visible:bg-[#313131] focus-visible:text-[#E9E9E9] data-[state=open]:bg-[#313131] data-[state=open]:text-[#E9E9E9]",
        className,
      )}
    >
      <Svg size={14} className="shrink-0 text-[#9B9B9B]">
        {ic.sort}
      </Svg>
      {SORTS[sort]}
      <Svg size={12} className="shrink-0 text-[#9B9B9B]">
        {ic.down}
      </Svg>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        sideOffset={4}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn("z-50 w-44 font-sans antialiased", MENU)}
      >
        <DropdownMenu.RadioGroup value={sort} onValueChange={(s) => onSort(s as Sort)}>
          {(Object.keys(SORTS) as Sort[]).map((s) => (
            <DropdownMenu.RadioItem key={s} value={s} className={ITEM}>
              <span className="flex-1">{SORTS[s]}</span>
              <DropdownMenu.ItemIndicator>
                <Svg size={14} sw={2}>
                  {ic.check}
                </Svg>
              </DropdownMenu.ItemIndicator>
            </DropdownMenu.RadioItem>
          ))}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

/* ── List ─────────────────────────────────────────────────────────────── */

type ItemProps = {
  items: WorkspaceWithThumbnail[];
  selected: string | null;
  onSelect: (id: string) => void;
  onOpen: (workspace: WorkspaceWithThumbnail) => void;
  // Without it, no Delete in a row's menu.
  onDelete?: (workspace: WorkspaceWithThumbnail) => void;
};

// For a list of rows (this one, and Published's): ↑ ↓ Home End move the focus
// from row to row. Only from a row itself: a key in its ⋯, or in a menu, is
// that one's.
export const rowKeys = (e: KeyboardEvent<HTMLElement>) => {
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="row"][tabindex]')];
  const at = rows.indexOf(e.target as HTMLElement);
  if (at === -1) return;
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: rows.length - 1 }[e.key];
  if (to === undefined) return;
  // Not the list's scroll: focusing the row brings it into view.
  e.preventDefault();
  rows[Math.max(0, Math.min(to, rows.length - 1))]?.focus();
};

// A menu is drawn in a portal, but its events still come up through the row
// it belongs to: a click in it isn't a click on the row.
const NOT_THE_ROWS = {
  onClick: (e: React.MouseEvent) => e.stopPropagation(),
  onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
  onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
};

const COLS = "grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_40px]";
// The name carries the row: medium, a step brighter and larger than what's beside it.
export const NAME = "truncate text-[14px] font-medium text-[#E9E9E9]";
export const META = "truncate text-[13px] text-[#B2B2B2] tabular-nums";
// The capture's tile is the canvas's grey (#282828), next to nothing against the page's: a
// hairline, the grey of the rules, says where it ends.
export const THUMB = "h-[60px] w-[96px] shrink-0 rounded-[6px] ring-1 ring-[#333333]";
export const HEADINGS = "sticky top-0 z-10 -mx-2 grid gap-4 bg-[#2A2A2A] px-2 pb-3 text-[12px] text-[#9B9B9B]";

type Action = { label: string; run: () => void; danger?: boolean };

// What a workspace's menu holds, for either of the two it's in: the right click's and the ⋯'s.
const actionsFor = (w: WorkspaceWithThumbnail, { onOpen, onDelete }: Pick<ItemProps, "onOpen" | "onDelete">): Action[] => [
  { label: "Open", run: () => onOpen(w) },
  ...(onDelete ? [{ label: "Delete", run: () => onDelete(w), danger: true }] : []),
];

// A row's, or a card's, ⋯ and the menu under it. There with the pointer, the keys, or while it's the selected one.
const More = ({ actions, stop, className }: { actions: Action[]; stop: boolean; className?: string }) => (
  <DropdownMenu.Root>
    <DropdownMenu.Trigger
      aria-label="More"
      tabIndex={stop ? 0 : -1}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-[6px] text-[#9B9B9B] opacity-0 outline-none group-hover:opacity-100 group-focus-visible:opacity-100 group-aria-selected:opacity-100 hover:bg-[#3D3D3D] hover:text-[#E9E9E9] focus-visible:bg-[#3D3D3D] focus-visible:text-[#E9E9E9] focus-visible:opacity-100 data-[state=open]:bg-[#3D3D3D] data-[state=open]:opacity-100",
        className,
      )}
    >
      <Svg size={15}>{ic.more}</Svg>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align="end"
        sideOffset={4}
        collisionPadding={8}
        className={cn("z-50 w-52 font-sans antialiased", MENU)}
        {...NOT_THE_ROWS}
      >
        {actions.map((a) => (
          <div key={a.label}>
            {a.danger && <DropdownMenu.Separator className="my-1 h-px bg-[#373737]" />}
            <DropdownMenu.Item onSelect={a.run} className={cn(ITEM, a.danger && DANGER)}>
              {a.label}
            </DropdownMenu.Item>
          </div>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
);

// Around a row or a card: the menu a right click on it opens.
const RightClickMenu = ({ actions, children }: { actions: Action[]; children: ReactNode }) => (
  <ContextMenu.Root>
    <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal>
      {/* Kept in the window: a right click can land at its edge. */}
      <ContextMenu.Content collisionPadding={8} className={cn("z-50 w-52 font-sans antialiased", MENU)}>
        {actions.map((a) => (
          <div key={a.label}>
            {a.danger && <ContextMenu.Separator className="my-1 h-px bg-[#373737]" />}
            <ContextMenu.Item onSelect={a.run} className={cn(ITEM, a.danger && DANGER)}>
              {a.label}
            </ContextMenu.Item>
          </div>
        ))}
      </ContextMenu.Content>
    </ContextMenu.Portal>
  </ContextMenu.Root>
);

type OneProps = {
  w: WorkspaceWithThumbnail;
  selected: boolean;
  // The list's one stop for Tab: this one, and its ⋯ after it.
  stop: boolean;
} & Pick<ItemProps, "onSelect" | "onOpen" | "onDelete">;

// What a row and a card share: a click selects, a double click or Enter opens, and reached with the keys it's the
// selected one, as when clicked.
const itemProps = ({ w, selected, stop, onSelect, onOpen }: OneProps) => ({
  role: "row",
  "aria-selected": selected,
  tabIndex: stop ? 0 : -1,
  onClick: () => onSelect(w.id),
  onFocus: (e: React.FocusEvent) => {
    if (e.target === e.currentTarget) onSelect(w.id);
  },
  onDoubleClick: () => onOpen(w),
  onContextMenu: () => onSelect(w.id),
  onKeyDown: (e: React.KeyboardEvent) => {
    // Its own, not the ⋯ button's inside it.
    if (e.key === "Enter" && e.target === e.currentTarget) onOpen(w);
  },
});

const Row = (p: OneProps) => {
  const { w, selected, stop } = p;
  const actions = actionsFor(w, p);
  return (
    <RightClickMenu actions={actions}>
      <div
        {...itemProps(p)}
        className={cn(
          // The selected ring is inset: drawn outside, the first row's top edge went under
          // the sticky column headings. scroll-mt: a row the keys bring into view stops
          // below them, not under them.
          "group -mx-2 grid scroll-mt-9 scroll-mb-2 cursor-default items-center gap-4 rounded-[10px] px-2 py-1.5 outline-none focus-visible:bg-[#313131]",
          COLS,
          selected ? "bg-[#313131] ring-1 ring-inset ring-white/30" : "hover:bg-[#313131]",
        )}
      >
        <div role="gridcell" className="flex min-w-0 items-center gap-4">
          <WorkspaceThumb workspace={w} className={THUMB} />
          <span className={NAME}>{w.name}</span>
        </div>
        <span role="gridcell" className={META}>
          {ago(w.lastActiveAt)}
        </span>
        <span role="gridcell" className={META}>
          {date(createdAt(w))}
        </span>
        <div role="gridcell" className="flex justify-end">
          <More actions={actions} stop={stop} />
        </div>
      </div>
    </RightClickMenu>
  );
};

export const ListRows = ({ items, selected, ...h }: ItemProps) => {
  // Tab stops at the selected row, or at the first while none is.
  const stop = items.some((w) => w.id === selected) ? selected : items[0]?.id;
  return (
    <div role="grid" aria-label="Workspaces" aria-rowcount={items.length + 1} onKeyDown={rowKeys}>
      {/* Stays on top of the rows as they scroll under it, as wide as they are. */}
      <div role="row" className={cn(HEADINGS, COLS)}>
        <span role="columnheader">Name</span>
        <span role="columnheader">Last active</span>
        <span role="columnheader">Created</span>
        <span role="columnheader" aria-label="Actions" />
      </div>
      <div role="rowgroup" className="space-y-1">
        {items.map((w) => (
          <Row key={w.id} w={w} selected={selected === w.id} stop={stop === w.id} {...h} />
        ))}
      </div>
    </div>
  );
};

/* ── Cards ────────────────────────────────────────────────────────────── */

// The same workspaces as cards, picture first. The keys as in the list, in two directions: ← → to the one beside,
// ↑ ↓ to the one above or below, Home and End to the first and last.
export const cardKeys = (e: KeyboardEvent<HTMLElement>) => {
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="row"][tabindex]')];
  const at = cards.indexOf(e.target as HTMLElement);
  if (at === -1) return;
  // As many across as share the first one's top.
  const across = cards.filter((card) => card.offsetTop === cards[0]!.offsetTop).length || 1;
  const to = { ArrowRight: at + 1, ArrowLeft: at - 1, ArrowDown: at + across, ArrowUp: at - across, Home: 0, End: cards.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  // ↓ from the row above a short last row goes to its last card; past either end, nowhere.
  if (to < 0) return;
  cards[Math.min(to, cards.length - 1)]?.focus();
};

// The cards' grid, for this list and Published's. -mx-2, with a card's own p-2: its picture lines up with the
// column, and what lights it runs past, as a row's does.
export const CARDS = "-mx-2 grid grid-cols-[repeat(auto-fill,minmax(216px,1fr))] gap-x-1 gap-y-3 pt-1";
export const CARD = "group min-w-0 scroll-mt-4 scroll-mb-4 cursor-default rounded-[12px] p-2 outline-none focus-visible:bg-[#313131]";
export const CARD_THUMB = "aspect-[16/10] w-full rounded-[7px] ring-1 ring-[#333333]";
export const CARD_META = "mt-0.5 truncate text-[12.5px] text-[#9B9B9B] tabular-nums";

const Card = (p: OneProps) => {
  const { w, selected, stop } = p;
  const actions = actionsFor(w, p);
  return (
    <RightClickMenu actions={actions}>
      <div
        {...itemProps(p)}
        className={cn(CARD, selected ? "bg-[#313131] ring-1 ring-inset ring-white/30" : "hover:bg-[#313131]")}
      >
        <div role="gridcell">
          <WorkspaceThumb workspace={w} className={CARD_THUMB} />
          <div className="mt-2.5 flex items-center gap-2 pb-0.5 pl-0.5">
            <div className="min-w-0 flex-1">
              <div className={NAME}>{w.name}</div>
              <div className={CARD_META}>{ago(w.lastActiveAt)}</div>
            </div>
            <More actions={actions} stop={stop} />
          </div>
        </div>
      </div>
    </RightClickMenu>
  );
};

export const GridCards = ({ items, selected, ...h }: ItemProps) => {
  const stop = items.some((w) => w.id === selected) ? selected : items[0]?.id;
  return (
    <div role="grid" aria-label="Workspaces" onKeyDown={cardKeys} className={CARDS}>
      {items.map((w) => (
        <Card key={w.id} w={w} selected={selected === w.id} stop={stop === w.id} {...h} />
      ))}
    </div>
  );
};
