import { useEffect, useRef } from "react";
import { Tabs, ToggleGroup } from "radix-ui";
import { cn } from "@/renderer/lib/utils";
import { SortMenu, type Sort } from "./LocalList";

export type View = "list" | "grid";
import { Btn, Svg, ic } from "./kit";

// The top of the dashboard: the title and New workspace, then one row on a
// rule: the sections as tabs with their counts, and search and sort at its
// end. It stays put; the list under it scrolls.
//
// The tabs are Radix's, inside the Tabs.Root that Dashboard.tsx puts around
// the page: one stop for Tab, ← → Home End between them, and the list is
// their panel.

export type Section = "local" | "published";

type HeaderProps = {
  // The tabs, in order. Picking one is the Tabs.Root's to hear of.
  sections: Section[];
  section: Section;
  // A section without one (not known yet) has no badge.
  counts: Partial<Record<Section, number>>;
  query: string;
  onQuery: (query: string) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
  // As rows or as cards. Without onView, there's no switch for it.
  view?: View;
  onView?: (view: View) => void;
  onNew: () => void;
};

const LABEL: Record<Section, string> = { local: "Local", published: "Published" };

// ⌘F puts the caret in it, Esc empties it, and ↓ goes on into the list. The
// ⌘F hint gives way to a clear button once there's a query.
const Search = ({ section, query, onQuery }: Pick<HeaderProps, "section" | "query" | "onQuery">) => {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-[32px] w-[260px] shrink-0 items-center gap-2 rounded-[8px] bg-[#313131] pr-2 pl-2.5">
      <Svg size={14} className="shrink-0 text-[#9B9B9B]">
        {ic.search}
      </Svg>
      <input
        ref={input}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            // The list's stop for Tab: its selected row, or its first.
            const row = e.currentTarget.closest("main")?.querySelector<HTMLElement>('[role="row"][tabindex="0"]');
            if (!row) return;
            e.preventDefault();
            row.focus();
          } else if (e.key === "Escape") {
            onQuery("");
            e.currentTarget.blur();
          }
        }}
        aria-label={section === "local" ? "Search workspaces" : "Search published"}
        placeholder={section === "local" ? "Search workspaces" : "Search published"}
        className="w-full min-w-0 bg-transparent text-[13px] text-[#E9E9E9] outline-none placeholder:text-[#9B9B9B]"
      />
      {query ? (
        <button
          onClick={() => {
            onQuery("");
            input.current?.focus();
          }}
          aria-label="Clear search"
          className="grid size-[20px] shrink-0 place-items-center rounded-[5px] text-[#9B9B9B] outline-none hover:bg-[#424242] hover:text-[#E9E9E9] focus-visible:bg-[#424242] focus-visible:text-[#E9E9E9]"
        >
          <Svg size={11} sw={2}>
            {ic.close}
          </Svg>
        </button>
      ) : (
        <kbd aria-hidden className="shrink-0 rounded-[5px] bg-[#3D3D3D] px-1.5 font-sans text-[11px] leading-[20px] text-[#9B9B9B]">
          ⌘F
        </kbd>
      )}
    </div>
  );
};

export const Header = (p: HeaderProps) => (
  <>
    <div className="flex h-[34px] items-center">
      <h1 className="text-[20px] font-medium tracking-[-0.015em] text-[#EBEBEB]">Workspaces</h1>
      <div className="flex-1" />
      <Btn kind="primary" onClick={p.onNew}>
        <Svg size={15} sw={2}>
          {ic.plus}
        </Svg>{" "}
        New workspace
      </Btn>
    </div>

    {/* Sort is the row's last, right beside search. Published has the one
        order, so a label says it there. */}
    <div className="mt-3 mb-5 flex h-[48px] items-center gap-2 border-b border-[#333333]">
      <Tabs.List aria-label="Workspaces" className="flex h-full gap-5">
        {p.sections.map((s) => {
          const on = p.section === s;
          return (
            <Tabs.Trigger
              key={s}
              value={s}
              className={cn(
                // Medium, as the title bar's tabs are, and in both states.
                "group relative flex items-center text-[13.5px] font-medium outline-none",
                on ? "text-[#EBEBEB]" : "text-[#9B9B9B] hover:text-[#E9E9E9] focus-visible:text-[#E9E9E9]",
              )}
            >
              {/* Lit behind the label while the keys are on it. */}
              <span className="-mx-1.5 flex items-center gap-1.5 rounded-[6px] px-1.5 py-1 group-focus-visible:bg-[#313131]">
                {LABEL[s]}
                {p.counts[s] !== undefined && (
                  <span
                    className={cn(
                      "min-w-[20px] rounded-[5px] px-1 text-center text-[11.5px] leading-[18px] font-medium tabular-nums",
                      on ? "bg-[#3D3D3D] text-[#EBEBEB]" : "bg-[#313131] text-[#B2B2B2]",
                    )}
                  >
                    {p.counts[s]}
                  </span>
                )}
              </span>
              {/* On the row's rule. */}
              {on && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[#EBEBEB]" />}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
      <div className="flex-1" />
      <Search section={p.section} query={p.query} onQuery={p.onQuery} />
      {p.section === "local" ? (
        <SortMenu sort={p.sort} onSort={p.onSort} />
      ) : (
        <span className="flex h-[32px] shrink-0 items-center gap-2 pl-2 text-[13px] whitespace-nowrap text-[#9B9B9B]">
          <Svg size={14} className="shrink-0">
            {ic.sort}
          </Svg>
          Newest first
        </span>
      )}
      {/* Radix's: one stop for Tab, ← → between the two. ml-3: clear of what lights the sort, which runs 8px past its chevron. */}
      {p.onView && (
        <ToggleGroup.Root
          type="single"
          value={p.view}
          onValueChange={(to) => to && p.onView?.(to as View)}
          aria-label="View"
          className="ml-3 flex h-[32px] shrink-0 items-center gap-[2px] rounded-[8px] bg-[#313131] p-[3px]"
        >
          {(["grid", "list"] as const).map((v) => (
            <ToggleGroup.Item
              key={v}
              value={v}
              aria-label={v === "grid" ? "Cards" : "List"}
              className="grid size-[26px] place-items-center rounded-[6px] text-[#9B9B9B] outline-none hover:text-[#E9E9E9] focus-visible:bg-[#3D3D3D] focus-visible:text-[#E9E9E9] data-[state=on]:bg-[#424242] data-[state=on]:text-[#EBEBEB]"
            >
              <Svg size={15}>{v === "grid" ? ic.grid : ic.list}</Svg>
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      )}
    </div>
  </>
);
