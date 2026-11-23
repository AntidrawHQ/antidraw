import { cn } from "@/renderer/lib/utils";
import { SortMenu, type Sort } from "./LocalList";
import { Btn, Svg, ic } from "./kit";

// The top of the dashboard: the title and New workspace, the sections as
// tabs on a rule with their counts, then search and sort. It stays put; the
// list under it scrolls.

export type Section = "local" | "published";

type HeaderProps = {
  // The tabs, in order.
  sections: Section[];
  section: Section;
  onSection: (section: Section) => void;
  counts: Partial<Record<Section, number>>;
  query: string;
  onQuery: (query: string) => void;
  sort: Sort;
  onSort: (sort: Sort) => void;
  onNew: () => void;
};

const LABEL: Record<Section, string> = { local: "Local", published: "Published" };

const Search = ({ section, query, onQuery }: Pick<HeaderProps, "section" | "query" | "onQuery">) => (
  <div className="flex h-[32px] w-[280px] items-center gap-2 rounded-[8px] bg-[#2A2A2A] px-2.5 focus-within:ring-1 focus-within:ring-[#7F8BE0]">
    <Svg size={14} className="shrink-0 text-[#9B9B9B]">
      {ic.search}
    </Svg>
    <input
      value={query}
      onChange={(e) => onQuery(e.target.value)}
      placeholder={section === "local" ? "Search workspaces" : "Search published"}
      className="w-full min-w-0 bg-transparent text-[13px] text-[#E9E9E9] outline-none placeholder:text-[#9B9B9B]"
    />
  </div>
);

export const Header = (p: HeaderProps) => (
  <>
    <div className="flex items-center">
      <h1 className="text-[28px] font-normal tracking-[-0.01em] text-[#EBEBEB]">Workspaces</h1>
      <div className="flex-1" />
      <Btn kind="primary" onClick={p.onNew}>
        <Svg size={15} sw={2}>
          {ic.plus}
        </Svg>{" "}
        New workspace
      </Btn>
    </div>

    <div className="mt-5 flex items-end gap-6 border-b border-[#333333]">
      {p.sections.map((s) => {
        const on = p.section === s;
        return (
          <button
            key={s}
            onClick={() => p.onSection(s)}
            aria-pressed={on}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-0.5 pt-1 pb-3 text-[14px]",
              on ? "border-[#EBEBEB] text-[#EBEBEB]" : "border-transparent text-[#9B9B9B] hover:text-[#E9E9E9]",
            )}
          >
            {LABEL[s]}
            <span
              className={cn(
                "rounded-full px-1.5 text-[12px] leading-[18px]",
                on ? "bg-[#373737] text-[#EBEBEB]" : "bg-[#2A2A2A] text-[#B2B2B2]",
              )}
            >
              {p.counts[s] ?? 0}
            </span>
          </button>
        );
      })}
    </div>

    <div className="mt-4 mb-6 flex items-center gap-2">
      <Search section={p.section} query={p.query} onQuery={p.onQuery} />
      <div className="flex-1" />
      {p.section === "local" && <SortMenu sort={p.sort} onSort={p.onSort} />}
    </div>
  </>
);
