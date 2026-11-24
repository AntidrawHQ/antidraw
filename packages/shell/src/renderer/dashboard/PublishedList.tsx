import type { PublishedSite } from "@/main/api";
import { cn } from "@/renderer/lib/utils";
import { ago } from "./LocalList";

// What the account has published, as rows, the latest published first. A
// click, or Enter, opens one view-only in the window's other tab.

const COLS = "grid-cols-[minmax(0,2.4fr)_minmax(0,2fr)_88px]";

export const PublishedRows = ({
  items,
  onOpen,
}: {
  items: PublishedSite[];
  onOpen: (site: PublishedSite) => void;
}) => (
  <div>
    {/* Stays on top of the rows as they scroll under it, as the Local list's. */}
    <div className={cn("sticky top-0 z-10 -mx-2 grid gap-4 bg-[#222222] px-2 pb-3 text-[13px] text-[#9B9B9B]", COLS)}>
      <span>Name</span>
      <span>Published</span>
      <span />
    </div>
    <div className="space-y-1">
      {items.map((site) => (
        <div
          key={site.id}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(site)}
          onKeyDown={(e) => e.key === "Enter" && onOpen(site)}
          className={cn(
            "group -mx-2 grid cursor-default items-center gap-4 rounded-[10px] px-2 py-1.5 outline-none hover:bg-[#262626] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#7F8BE0]",
            COLS,
          )}
        >
          <div className="flex min-w-0 items-center gap-4">
            {/* No picture of a published canvas yet: the canvas's grey. */}
            <div className="h-[60px] w-[96px] shrink-0 rounded-[6px] bg-[#282828]" />
            <span className="truncate text-[14.5px] text-[#E9E9E9]">{site.title}</span>
          </div>
          <span className="truncate text-[13.5px] text-[#B2B2B2]">
            v{site.version} · {ago(site.publishedAt)}
          </span>
          {/* Fork's place. */}
          <span />
        </div>
      ))}
    </div>
  </div>
);
