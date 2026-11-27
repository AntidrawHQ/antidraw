import { useEffect, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { PublishedSite } from "@/main/api";
import { Canvas } from "@/renderer/canvas/Canvas";
import type { CanvasFile } from "@/renderer/canvas/canvas-file";
import { Btn, Chip, Svg, ic } from "@/renderer/dashboard/kit";
import { ago } from "@/renderer/dashboard/LocalList";
import { useAccount } from "@/renderer/lib/account-ops";
import { queryKeys } from "@/renderer/lib/query-keys";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { ForkButton, useFork } from "./Fork";

// A published site in the window's tab: its canvas and nothing to change it
// with. No chat, no panels and no tools; the frames load the site's own
// pages, as its share page shows them (@antidraw/share-page), and can be
// looked at, panned, zoomed and used, not moved. To change it, it's forked
// (./Fork.tsx): the tab becomes the fork.

// The parts of canvas.json the canvas reads. The file is the site's, so it's
// checked: the canvas takes it as it comes.
const canvasFile = z.object({
  name: z.string(),
  components: z.array(z.object({ name: z.string() })),
  layouts: z.array(
    z.object({
      componentName: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    }),
  ),
});

// Where the site's files are, as the share page finds them (its site.ts).
const siteFiles = (site: PublishedSite) => {
  const base = new URL(`${site.filesUrl}/`);
  return {
    canvasFile: new URL("canvas.json", base).href,
    // The Preview page of the workspace's build (@antidrawapp/runtime).
    frameUrl: (componentName: string) =>
      new URL(`preview?componentName=${encodeURIComponent(componentName)}`, base).href,
  };
};

// A frame's fullscreen button: its page in the browser (main sends a window
// the page opens there).
const openInBrowser = (url: string) => {
  window.open(url, "_blank", "noopener");
};

const Message = ({ children }: { children: React.ReactNode }) => (
  <div className="absolute inset-0 grid place-items-center bg-[#282828] text-[13px] text-[#9B9B9B]">
    <div className="flex flex-col items-center gap-4">{children}</div>
  </div>
);

const SiteCanvas = ({ site }: { site: PublishedSite }) => {
  const dashboardShown = useWorkspaceStore((s) => s.dashboardShown);
  const files = siteFiles(site);
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: queryKeys.published.canvas(site.id, site.version),
    queryFn: async (): Promise<Pick<CanvasFile, "name" | "components" | "layouts">> => {
      const response = await fetch(files.canvasFile, { credentials: "omit" });
      if (!response.ok) throw new Error(`canvas.json: ${response.status}`);
      return canvasFile.parse(await response.json());
    },
    // A version's canvas doesn't change.
    staleTime: Infinity,
    // Try again is the retry.
    retry: false,
  });

  if (isPending) return <Message>Loading…</Message>;
  if (error || !data) {
    return (
      <Message>
        <span>This canvas could not be loaded.</span>
        <Btn kind="secondary" small disabled={isFetching} onClick={() => void refetch()}>
          Try again
        </Btn>
      </Message>
    );
  }
  if (data.components.length === 0) return <Message>Nothing here yet.</Message>;

  return (
    <ReactFlowProvider>
      <Canvas
        components={data.components}
        savedLayouts={data.layouts}
        frameUrl={files.frameUrl}
        onFullscreen={openInBrowser}
        readOnly
        // Under the dashboard: see the workspace's canvas (renderer/Canvas.tsx).
        keysOff={dashboardShown}
      />
    </ReactFlowProvider>
  );
};

// Two letters for the account's badge: its first and last names', or the
// first two of a single name.
const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words.at(-1)![0]! : (words[0] ?? "").slice(0, 2);
  return letters.toUpperCase();
};

const COPIED_MS = 2200;

export const PublishedViewer = ({ site }: { site: PublishedSite }) => {
  // The list is the account's own, so the account is who published it.
  const { data: account } = useAccount();
  const [copied, setCopied] = useState(false);
  const { fork, dialog } = useFork();

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);

  const copyLink = () => {
    navigator.clipboard?.writeText(site.url).catch(() => {});
    setCopied(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#222222] font-sans antialiased">
      <div className="flex h-[48px] shrink-0 items-center gap-3 border-b border-[#2E2E2E] px-4">
        <Svg size={15} className="shrink-0 text-[#9B9B9B]">
          {ic.eye}
        </Svg>
        <span className="min-w-0 shrink truncate text-[14px] text-[#EBEBEB]">{site.title}</span>
        <Chip>View only</Chip>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-[#B2B2B2]">
          {account && (
            <span
              aria-hidden
              className="grid size-[18px] shrink-0 place-items-center rounded-full bg-[#D9A066] text-[8px] font-semibold text-[#1C1C1C] shadow-[0_0_0_2px_#222222]"
            >
              {initials(account.name)}
            </span>
          )}
          <span className="truncate">
            {account ? `Published by ${account.name}` : "Published"} · v{site.version} · {ago(site.publishedAt)}
          </span>
        </span>
        <Btn kind="ghost" small onClick={copyLink}>
          <Svg size={13}>{ic.link}</Svg> Copy link
        </Btn>
        <ForkButton primary site={site} onFork={fork} />
      </div>
      <div className="relative min-h-0 flex-1">
        {/* A new canvas for another site, or another version of this one. */}
        <SiteCanvas key={`${site.id}@${site.version}`} site={site} />
        {/* Not under the Copied line, which is in its place. */}
        {!copied && (
          <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[#2A2A2A] px-3.5 py-1.5 text-[12.5px] whitespace-nowrap text-[#B2B2B2] ring-1 ring-[#3D3D3D]">
            {site.forkable
              ? "A published snapshot: look, pan and zoom. Fork it to get the source and change it."
              : "A published snapshot: look, pan and zoom."}
          </div>
        )}
        {copied && (
          <div
            role="status"
            className="pointer-events-none absolute bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[#F2F2F2] px-4 py-2 text-[13px] whitespace-nowrap text-[#222222] shadow-xl"
          >
            Copied {site.url.replace(/^https?:\/\//, "")}
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
};
