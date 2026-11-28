import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ReactFlowProvider } from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import type { ForkStatus, PublishedSite } from "@/main/api";
import { Canvas } from "@/renderer/canvas/Canvas";
import type { CanvasFile } from "@/renderer/canvas/canvas-file";
import { Btn, Svg, ic } from "@/renderer/dashboard/kit";
import { ago } from "@/renderer/dashboard/LocalList";
import { queryKeys } from "@/renderer/lib/query-keys";
import { useForkSiteFlow, type WorkspaceFlowStatus } from "@/renderer/lib/use-create-workspace-flow";
import { cn } from "@/renderer/lib/utils";
import { useSwitchWorkspace } from "@/renderer/lib/workspace-ops";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { NOT_FORKABLE } from "./Fork";
import { useTitlebarSlot } from "./titlebar-slot";

// A published site in the window's tab: its canvas and nothing to change it
// with. No chat, no panels and no tools; the frames load the site's own
// pages, as its share page shows them (@antidraw/share-page), and can be
// looked at, panned, zoomed and used, not moved. To change it, it's forked
// (./Fork.tsx): the tab becomes the fork. Its controls are on the window's
// titlebar, and the whole of it is in the workspace view's greys: #2A2A2A
// bar, #333 rule, #282828 canvas, #2c2c2c surfaces over it.

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

const SiteCanvas = ({ site, keysOff }: { site: PublishedSite; keysOff: boolean }) => {
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
        // Under the dashboard or a fork: see the workspace's canvas (renderer/Canvas.tsx).
        keysOff={keysOff}
      />
    </ReactFlowProvider>
  );
};

const COPIED_MS = 1400;
const OPEN_MS = 120;
const CLOSE_MS = 150;

const NO_DRAG = { WebkitAppRegion: "no-drag" } as CSSProperties;

// View only, and on hover (or focus) why: a card under it in the MCP
// popover's look (McpSetup.tsx: #2c2c2c, 14px radius), saying the site can't
// be changed here and that Fork, beside it, is how to work on it.
const ViewOnly = ({ site }: { site: PublishedSite }) => {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const later = (to: boolean, ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(to), ms);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  // Hover and focus content can be put away where it is, wherever the keys
  // are (WCAG 1.4.13): a card the pointer opened hasn't the focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      clearTimeout(timer.current);
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div
      className="relative min-w-0 max-[720px]:hidden"
      onMouseEnter={() => later(true, OPEN_MS)}
      // Open while either is on it: the pointer leaving doesn't close a card
      // the focus is on.
      onMouseLeave={(e) => !e.currentTarget.contains(document.activeElement) && later(false, CLOSE_MS)}
      onFocus={() => {
        // A close the pointer scheduled doesn't outlast the focus.
        clearTimeout(timer.current);
        setOpen(true);
      }}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
    >
      <span
        tabIndex={0}
        aria-describedby="view-only-card"
        className={cn(
          // Its focus shows with the card put away, too.
          "flex h-[26px] min-w-0 cursor-default items-center gap-1.5 rounded-lg px-2 text-[12.5px] transition-colors outline-none focus-visible:bg-white/[0.06] focus-visible:text-[#e0e0e0]",
          open ? "bg-white/[0.06] text-[#e0e0e0]" : "text-[#9a9a9a] hover:text-[#e0e0e0]",
        )}
      >
        <Svg size={13} sw={2} className="shrink-0">
          {ic.eye}
        </Svg>
        <span className="truncate">
          View only
          {/* When, only where there's room for it beside the site's tab. ago()
              is written to stand alone: "Just now" mid-sentence is "just now". */}
          <span className="max-[960px]:hidden"> · Published {ago(site.publishedAt).replace(/^Just/, "just")}</span>
        </span>
      </span>

      {open && (
        <div
          id="view-only-card"
          role="tooltip"
          className="absolute top-[calc(100%+8px)] right-0 z-[80] w-[300px] animate-[view-only-pop_0.18s_cubic-bezier(0.23,1,0.32,1)] rounded-[14px] border border-[#2d2d2d] bg-[#2c2c2c] p-3.5 text-left font-[450] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)]"
        >
          <style>{`@keyframes view-only-pop { from { opacity: 0; transform: translateY(-4px) scale(0.97); } to { opacity: 1; transform: none; } }`}</style>
          <h2 className="text-[14px] leading-5 font-medium tracking-[-0.01em] text-neutral-50">
            This canvas is view only
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-[18px] text-balance text-neutral-400">
            It's a published snapshot, so nothing here can be changed.{" "}
            {site.forkable
              ? "To work on it, Fork it: you'll get its source as a workspace of your own."
              : // Fork's own reason is a title on a disabled button, which keys can't reach.
                `It was published before its source was kept, so it can't be forked yet. ${NOT_FORKABLE}.`}
          </p>
        </div>
      )}
    </div>
  );
};

// What Copy link last did, for a moment: each copy its own, so a second one
// keeps it up and is read out again.
type Copy = { said: "copied" | "failed"; n: number } | null;

const COPY_LABELS = { idle: "Copy link", copied: "Copied", failed: "Not copied" } as const;

// The titlebar's right side for a published site: View only and when it was
// published, then Copy link, and Fork as the primary action.
const SiteDetails = ({
  site,
  forking,
  copy,
  onCopy,
  onFork,
  forkRef,
}: {
  site: PublishedSite;
  forking: boolean;
  copy: Copy;
  onCopy: () => void;
  onFork: () => void;
  forkRef: React.Ref<HTMLButtonElement>;
}) => {
  const said = copy?.said ?? "idle";
  return (
    <>
      <ViewOnly site={site} />
      <span className="mx-1 h-4 w-px bg-[#3a3a3a] max-[720px]:hidden" />
      {/* As the publish panel's Copy: what happened on the button for a
          moment, no toast. Each label is laid in the same cell, the ones not
          showing hidden, so the button is as wide as the widest and nothing
          beside it moves. */}
      <button
        onClick={onCopy}
        className="flex h-[26px] shrink-0 cursor-default items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[13px] font-medium text-[#e0e0e0] transition-colors hover:bg-white/[0.1]"
      >
        {said === "copied" ? (
          <Check size={13} strokeWidth={2.5} className="text-neutral-400" />
        ) : (
          <Svg size={13} sw={2}>
            {said === "failed" ? ic.close : ic.link}
          </Svg>
        )}
        <span className="grid">
          {(Object.keys(COPY_LABELS) as (keyof typeof COPY_LABELS)[]).map((key) => (
            <span
              key={key}
              data-copy-label
              className={cn("col-start-1 row-start-1 text-center", key !== said && "invisible")}
              aria-hidden={key !== said || undefined}
            >
              {COPY_LABELS[key]}
            </span>
          ))}
        </span>
      </button>
      {/* The button's new name isn't read out on its own. */}
      <span role="status" className="sr-only">
        {copy?.said === "copied"
          ? copy.n % 2
            ? "Link copied"
            : "Link copied again"
          : copy?.said === "failed"
            ? "The link couldn't be copied"
            : ""}
      </span>
      {/* Publish's shape: the one primary action, as Publish is a workspace's. */}
      <button
        ref={forkRef}
        onClick={onFork}
        disabled={forking || !site.forkable}
        title={site.forkable ? undefined : NOT_FORKABLE}
        aria-label={`Fork ${site.title}`}
        className="flex h-[26px] min-w-[72px] shrink-0 cursor-default items-center justify-center gap-1.5 rounded-lg bg-[#e0e0e0] px-2.5 text-[13px] font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60 disabled:hover:bg-[#e0e0e0]"
      >
        <Svg size={13} sw={2}>
          {ic.fork}
        </Svg>
        Fork
      </button>
    </>
  );
};

// The fork's steps, as main reports them (main/services/fork.ts). No version:
// main forks the site's live one, which may be newer than the one shown.
const FORK_STEPS: { key: ForkStatus; label: string }[] = [
  { key: "FETCHING_SOURCE", label: "Pulling the site's source" },
  { key: "INSTALLING_DEPENDENCIES", label: "Installing packages" },
  { key: "SAVING_WORKSPACE", label: "Starting the canvas" },
];

// How long the last step shows done before the tab becomes the fork.
const FORKED_MS = 600;

// Forking: the site's source pulled into a workspace of your own, then opened
// in this tab, on a card over the canvas it's forking. A failed step is the
// progress list's red (CreateWorkspaceProgress), with why and Try again.
//
// Drawn over the canvas, but modal to the whole window, as the rows' fork
// dialog is: until it's done or has failed, nothing else can be used, the
// titlebar's tabs included. So the site can't be left, or another put in its
// place, under a fork of it; and nor can a coding agent outside the app do it
// (forkUnderWay, lib/outside-agent.ts). The fork's outcome lands here.
const ForkCard = ({
  container,
  site,
  status,
  failedStep,
  errorMessage,
  onRetry,
  onClose,
  onClosed,
}: {
  container: HTMLElement | null;
  site: PublishedSite;
  status: WorkspaceFlowStatus<ForkStatus>;
  failedStep: ForkStatus | null;
  errorMessage: string | null;
  onRetry: () => void;
  onClose: () => void;
  // Where the keys go once it's put away: it has no trigger of its own.
  onClosed: () => void;
}) => {
  const steps = FORK_STEPS;
  const failed = status === "error";
  const at =
    status === "done"
      ? steps.length
      : steps.findIndex((step) => step.key === (failed ? failedStep : status));
  // Only once it has failed: there's no stopping a fork under way.
  const closeIfFailed = (e: Event) => !failed && e.preventDefault();
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && failed && onClose()}>
      <DialogPrimitive.Portal container={container}>
        <DialogPrimitive.Overlay className="absolute inset-0 z-[70] grid place-items-center bg-black/50">
          <DialogPrimitive.Content
            aria-describedby={undefined}
            onEscapeKeyDown={closeIfFailed}
            onPointerDownOutside={closeIfFailed}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              onClosed();
            }}
            className="w-[340px] rounded-[12px] bg-[#2c2c2c] p-5 shadow-[0_0_0_1px_#2d2d2d,0_20px_48px_-8px_rgba(0,0,0,0.75)] outline-none"
          >
            <DialogPrimitive.Title className="mb-4 flex items-center gap-2 text-[15px] font-normal text-[#e0e0e0]">
              <Svg size={15}>{ic.fork}</Svg>
              <span className="truncate">Forking {site.title}</span>
            </DialogPrimitive.Title>
            {/* What's read out as it goes: the marks beside the steps say it
                only to the eye. As CreateWorkspaceProgress has it. */}
            <div role="status" className="sr-only">
              {status === "done"
                ? "Forked"
                : failed
                  ? `${steps[at]?.label ?? "The fork"} failed`
                  : steps[at]
                    ? `${steps[at].label}…`
                    : ""}
            </div>
            <div className="space-y-2.5">
              {steps.map((step, i) => {
                const done = i < at;
                const active = i === at;
                const broke = failed && active;
                return (
                  <div
                    key={step.key}
                    className={cn("flex items-center gap-2.5 text-[13.5px]", done || active ? "text-[#e0e0e0]" : "text-[#a3a3a3]")}
                  >
                    <span
                      className={cn(
                        "grid size-[18px] place-items-center rounded-full",
                        broke
                          ? "bg-[#d9605c] text-[#1C1C1C]"
                          : done
                            ? "bg-[#86D8A6] text-[#1C1C1C]"
                            : "ring-1 ring-[#a3a3a3] ring-inset",
                      )}
                    >
                      {broke ? (
                        <Svg size={10} sw={2.6}>
                          {ic.close}
                        </Svg>
                      ) : done ? (
                        <Svg size={11} sw={2.6}>
                          {ic.check}
                        </Svg>
                      ) : active ? (
                        <span className="size-1.5 animate-pulse rounded-full bg-[#e0e0e0]" />
                      ) : null}
                    </span>
                    {step.label}
                  </div>
                );
              })}
            </div>
            {failed && (
              <>
                <p role="alert" className="mt-4 text-[12.5px] leading-[18px] text-[#e08a86]">
                  {errorMessage ?? "The fork didn't finish."}
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <Btn kind="ghost" small onClick={onClose}>
                    Close
                  </Btn>
                  {/* Where the keys go once it has failed. */}
                  <Btn kind="secondary" small autoFocus onClick={onRetry}>
                    Try again
                  </Btn>
                </div>
              </>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export const PublishedViewer = ({ site }: { site: PublishedSite }) => {
  const dashboardShown = useWorkspaceStore((s) => s.dashboardShown);
  const slot = useTitlebarSlot((s) => s.el);
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null);
  const [copy, setCopy] = useState<Copy>(null);
  const forkButton = useRef<HTMLButtonElement>(null);
  // The site being forked: the card's words and Try again are its, whatever
  // the tab shows.
  const [forked, setForked] = useState<PublishedSite | null>(null);
  const forkedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(forkedTimer.current), []);
  const switchWorkspace = useSwitchWorkspace();
  const { status, errorMessage, failedStep, isCreating, start, reset } = useForkSiteFlow({
    onSuccess: (workspace) => {
      // The last step seen done, then the fork in the site's place.
      forkedTimer.current = setTimeout(() => {
        setForked(null);
        reset();
        void switchWorkspace(workspace.id);
      }, FORKED_MS);
    },
  });
  const forking = status !== "idle";

  // Each copy keeps it up for the whole moment.
  useEffect(() => {
    if (!copy) return;
    const id = setTimeout(() => setCopy(null), COPIED_MS);
    return () => clearTimeout(id);
  }, [copy]);

  // Copied only once it is; and if it can't be, saying so.
  const copyLink = () => {
    const said = (said: "copied" | "failed") => setCopy((last) => ({ said, n: (last?.n ?? 0) + 1 }));
    if (!navigator.clipboard) return said("failed");
    navigator.clipboard.writeText(site.url).then(
      () => said("copied"),
      () => said("failed"),
    );
  };

  const fork = () => {
    if (isCreating || !site.forkable) return;
    setForked(site);
    start(site.id);
  };

  const close = () => {
    setForked(null);
    reset();
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#282828] font-sans antialiased">
      {/* No bar of its own: the tab names the site, and the rest is on the
          titlebar's right. Hidden, not gone, under the dashboard. */}
      {slot &&
        createPortal(
          <div style={NO_DRAG} className={cn("flex min-w-0 items-center gap-2", dashboardShown && "hidden")}>
            <SiteDetails
              site={site}
              forking={forking}
              copy={copy}
              onCopy={copyLink}
              onFork={fork}
              forkRef={forkButton}
            />
          </div>,
          slot,
        )}
      <div ref={setCanvasEl} className="relative min-h-0 flex-1">
        {/* A new canvas for another site, or another version of this one. */}
        <SiteCanvas key={`${site.id}@${site.version}`} site={site} keysOff={dashboardShown || forking} />
        {forking && forked && (
          <ForkCard
            container={canvasEl}
            site={forked}
            status={status}
            failedStep={failedStep}
            errorMessage={errorMessage}
            onRetry={() => !isCreating && start(forked.id)}
            onClose={close}
            onClosed={() => forkButton.current?.focus()}
          />
        )}
      </div>
    </div>
  );
};
