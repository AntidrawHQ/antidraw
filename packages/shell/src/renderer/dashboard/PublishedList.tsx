import { useState } from "react";
import type { PublishedSite } from "@/main/api";
import { cn } from "@/renderer/lib/utils";
import { CARD, CARDS, CARD_META, CARD_THUMB, HEADINGS, META, NAME, THUMB, ago, cardKeys, rowKeys } from "./LocalList";

// What the account has published, as rows, the latest published first. A
// click, or Enter, opens one view-only in the window's other tab. One stop for
// Tab, and ↑ ↓ Home End through it, as the Local list. As cards too, as that
// list is.

const COLS = "grid-cols-[minmax(0,2.4fr)_minmax(0,2fr)_88px]";

export const PublishedRows = ({
  items,
  onOpen,
}: {
  items: PublishedSite[];
  onOpen: (site: PublishedSite) => void;
}) => {
  // Tab stops at the row the keys were last on, or at the first.
  const [last, setLast] = useState<string>();
  const stop = items.some((site) => site.id === last) ? last : items[0]?.id;
  return (
    <div role="grid" aria-label="Published" aria-rowcount={items.length + 1} onKeyDown={rowKeys}>
      {/* Stays on top of the rows as they scroll under it, as the Local list's. */}
      <div role="row" className={cn(HEADINGS, COLS)}>
        <span role="columnheader">Name</span>
        <span role="columnheader">Published</span>
        <span role="columnheader" aria-label="Actions" />
      </div>
      <div role="rowgroup" className="space-y-1">
        {items.map((site) => (
          <div
            key={site.id}
            role="row"
            tabIndex={stop === site.id ? 0 : -1}
            onFocus={() => setLast(site.id)}
            onClick={() => onOpen(site)}
            onKeyDown={(e) => e.key === "Enter" && onOpen(site)}
            className={cn(
              "group -mx-2 grid scroll-mt-9 scroll-mb-2 cursor-default items-center gap-4 rounded-[10px] px-2 py-1.5 outline-none hover:bg-[#313131] focus-visible:bg-[#313131]",
              COLS,
            )}
          >
            <div role="gridcell" className="flex min-w-0 items-center gap-4">
              {/* No picture of a published canvas yet: the canvas's grey. */}
              <div className={cn(THUMB, "bg-[#282828]")} />
              <span className={NAME}>{site.title}</span>
            </div>
            <span role="gridcell" className={META}>
              v{site.version} · {ago(site.publishedAt)}
            </span>
            {/* Fork's place. */}
            <span role="gridcell" />
          </div>
        ))}
      </div>
    </div>
  );
};

export const PublishedCards = ({
  items,
  onOpen,
}: {
  items: PublishedSite[];
  onOpen: (site: PublishedSite) => void;
}) => {
  // Tab stops at the card the keys were last on, or at the first.
  const [last, setLast] = useState<string>();
  const stop = items.some((site) => site.id === last) ? last : items[0]?.id;
  return (
    <div role="grid" aria-label="Published" onKeyDown={cardKeys} className={CARDS}>
      {items.map((site) => (
        <div
          key={site.id}
          role="row"
          tabIndex={stop === site.id ? 0 : -1}
          onFocus={() => setLast(site.id)}
          onClick={() => onOpen(site)}
          onKeyDown={(e) => e.key === "Enter" && onOpen(site)}
          className={cn(CARD, "hover:bg-[#313131]")}
        >
          <div role="gridcell">
            {/* No picture of a published canvas yet: the canvas's grey. */}
            <div className={cn(CARD_THUMB, "bg-[#282828]")} />
            <div className="mt-2.5 pb-0.5 pl-0.5">
              <div className={NAME}>{site.title}</div>
              <div className={CARD_META}>
                v{site.version} · {ago(site.publishedAt)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
