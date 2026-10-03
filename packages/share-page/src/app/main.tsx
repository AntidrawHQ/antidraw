import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { ReactFlowProvider } from "@xyflow/react";
import { Canvas, GridPattern } from "@/renderer/canvas/Canvas";
import type { CanvasFile } from "@/renderer/canvas/canvas-file";
import { siteFor, slugFromPath } from "../site";
import "./app.css";

// The share page: the shell's canvas, read-only, over the site published at
// <slug>.antidraw.app. canvas.json says which components to show and where;
// each frame loads the site's Preview page. Frames can still be moved and
// resized, but nothing is saved.

const SITE_URL_PATTERN =
  import.meta.env.VITE_SITE_URL_PATTERN ??
  // The site Worker's `npm run dev` (@antidraw/site-worker).
  (import.meta.env.DEV ? "http://*.localhost:8787" : "https://*.antidraw.app");

class NotPublished extends Error {}

const openFullscreen = (url: string) => {
  window.open(url, "_blank", "noopener");
};

const Message = ({ text }: { text: string }) => (
  <div className="relative flex h-full items-center justify-center">
    <GridPattern />
    <div className="z-10 text-sm text-neutral-500">{text}</div>
  </div>
);

const SharedCanvas = ({ slug }: { slug: string }) => {
  const site = useMemo(() => siteFor(SITE_URL_PATTERN, slug), [slug]);
  const { data, error, isPending } = useQuery({
    queryKey: ["canvas-file", site.canvasFile],
    queryFn: async (): Promise<CanvasFile> => {
      const res = await fetch(site.canvasFile);
      if (res.status === 404) throw new NotPublished();
      if (!res.ok) throw new Error(`canvas.json: ${res.status}`);
      return res.json();
    },
    retry: (failures, error) => !(error instanceof NotPublished) && failures < 3,
  });

  if (isPending) return <Message text="Loading…" />;
  if (error instanceof NotPublished) return <Message text="There's no canvas here" />;
  if (error) return <Message text="This canvas could not be loaded" />;
  if (data.components.length === 0) return <Message text="Nothing here yet" />;

  return (
    <ReactFlowProvider>
      <div className="relative h-full">
        <div className="pointer-events-none absolute left-4 top-3 z-10 text-xs font-medium text-neutral-400">
          {data.name}
        </div>
        <Canvas
          components={data.components}
          savedLayouts={data.layouts}
          frameUrl={site.frameUrl}
          onFullscreen={openFullscreen}
        />
      </div>
    </ReactFlowProvider>
  );
};

const slug = slugFromPath(location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      {slug ? <SharedCanvas slug={slug} /> : <Message text="There's no canvas here" />}
    </QueryClientProvider>
  </StrictMode>,
);
