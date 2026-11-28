import { useState } from "react";
import type { PublishedSite } from "@/main/api";
import { ForkButton } from "@/renderer/published/Fork";
import { cn } from "@/renderer/lib/utils";
import { CARD, CARDS, CARD_META, CARD_THUMB, HEADINGS, META, NAME, THUMB, ago, cardKeys, rowKeys, useFirstRows } from "./LocalList";

// What the account has published, as rows, the latest published first. A
// click, or Enter, opens one view-only in the window's other tab; its Fork
// makes a workspace of it (published/Fork.tsx). One stop for Tab, and ↑ ↓ Home
// End through it, as the Local list; Tab from a row goes to its Fork. As cards
// too, as that list is.

type Props = {
  items: PublishedSite[];
  onOpen: (site: PublishedSite) => void;
  onFork: (site: PublishedSite) => void;
};

const COLS = "grid-cols-[minmax(0,2.4fr)_minmax(0,2fr)_88px]";

// The site's preview image: a picture of its canvas, taken by the server
// when the version went live and served with the site's files (og.jpg). On
// the canvas's grey: a site that has no picture yet, or whose picture can't
// be loaded, is that grey alone. The version in the address is for the
// cache: a new version's picture has a new address.
const SiteThumb = ({ site, className }: { site: PublishedSite; className: string }) => {
  const src = `${site.filesUrl}/og.jpg?v=${site.version}`;
  const [failed, setFailed] = useState<string>();
  return (
    <div className={cn(className, "relative overflow-hidden bg-[#282828]")}>
      {failed !== src && (
        <img
          src={src}
          alt=""
          draggable={false}
          loading="lazy"
          onError={() => setFailed(src)}
          // Filled, its edges cut: the picture is wider than the tile.
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </div>
  );
};

export const PublishedRows = ({ items, onOpen, onFork }: Props) => {
  const shown = useFirstRows(items);
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
        {shown.map((site) => (
          <div
            key={site.id}
            role="row"
            tabIndex={stop === site.id ? 0 : -1}
            onFocus={() => setLast(site.id)}
            onClick={() => onOpen(site)}
            // Its own Enter, not its Fork's.
            onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen(site)}
            className={cn(
              "group -mx-2 grid scroll-mt-9 scroll-mb-2 cursor-default items-center gap-4 rounded-[10px] px-2 py-1.5 outline-none hover:bg-[#313131] focus-visible:bg-[#313131]",
              COLS,
            )}
          >
            <div role="gridcell" className="flex min-w-0 items-center gap-4">
              <SiteThumb site={site} className={THUMB} />
              <span className={NAME}>{site.title}</span>
            </div>
            <span role="gridcell" className={META}>
              v{site.version} · {ago(site.publishedAt)}
            </span>
            <span role="gridcell" className="flex justify-end">
              <ForkButton site={site} onFork={onFork} tabIndex={stop === site.id ? 0 : -1} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const PublishedCards = ({ items, onOpen, onFork }: Props) => {
  const shown = useFirstRows(items);
  // Tab stops at the card the keys were last on, or at the first.
  const [last, setLast] = useState<string>();
  const stop = items.some((site) => site.id === last) ? last : items[0]?.id;
  return (
    <div role="grid" aria-label="Published" onKeyDown={cardKeys} className={CARDS}>
      {shown.map((site) => (
        <div
          key={site.id}
          role="row"
          tabIndex={stop === site.id ? 0 : -1}
          onFocus={() => setLast(site.id)}
          onClick={() => onOpen(site)}
          onKeyDown={(e) => e.key === "Enter" && e.target === e.currentTarget && onOpen(site)}
          className={cn(CARD, "hover:bg-[#313131]")}
        >
          <div role="gridcell">
            <SiteThumb site={site} className={CARD_THUMB} />
            <div className="mt-2.5 flex items-start gap-2 pb-0.5 pl-0.5">
              <div className="min-w-0 flex-1">
                <div className={NAME}>{site.title}</div>
                <div className={CARD_META}>
                  v{site.version} · {ago(site.publishedAt)}
                </div>
              </div>
              <ForkButton site={site} onFork={onFork} tabIndex={stop === site.id ? 0 : -1} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
