import { StrictMode, Suspense, lazy, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { CanvasFile } from "@/renderer/canvas/canvas-file";
import { siteFor, slugFromPath } from "../site";
import { Message } from "./Message";
import { TouchSnapshot } from "./touch/TouchSnapshot";
import "./app.css";

// The share page, over the site published at <slug>.antidraw.app.
// canvas.json says which components to show and where. With a mouse or
// trackpad it is the shell's canvas, read-only (./CanvasView). On a phone or
// tablet it is the components as a list, one running at a time (./touch):
// the canvas runs them all at once, which is more memory than a page gets
// there.

const SITE_URL_PATTERN =
  import.meta.env.VITE_SITE_URL_PATTERN ??
  // The site Worker's `npm run dev` (@antidraw/site-worker).
  (import.meta.env.DEV ? "http://*.localhost:8787" : "https://*.antidraw.app");

// A phone or tablet: its main pointer is a finger. A laptop with a touch
// screen has a trackpad for that, and keeps the canvas. Read once: a page
// doesn't change devices.
const TOUCH = window.matchMedia("(pointer: coarse)").matches;

const CanvasView = lazy(() => import("./CanvasView"));

class NotPublished extends Error {}

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

  if (TOUCH) return <TouchSnapshot file={data} frameUrl={site.frameUrl} />;
  return (
    <Suspense fallback={<Message text="Loading…" />}>
      <CanvasView file={data} frameUrl={site.frameUrl} />
    </Suspense>
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
