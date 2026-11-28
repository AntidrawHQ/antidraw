import { useState, type ReactNode } from "react";
import type { ForkStatus, PublishedSite } from "@/main/api";
import { CreateWorkspaceProgress, type ProgressStep } from "@/renderer/components/CreateWorkspaceProgress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/renderer/components/ui/dialog";
import { Btn, Svg, ic } from "@/renderer/dashboard/kit";
import { useForkSiteFlow } from "@/renderer/lib/use-create-workspace-flow";
import { useSwitchWorkspace } from "@/renderer/lib/workspace-ops";

// Forking a published site: its live version's source, pulled to this Mac as
// a new workspace (main/services/fork.ts) and opened in the window's tab. The
// fork is the user's own copy: the site stays as it is, and publishing the
// fork makes a new one.

// The live version, which is the one forked: not always the one in view,
// when the site was published again since it was opened.
const steps: ProgressStep<ForkStatus>[] = [
  { key: "FETCHING_SOURCE", label: "Pulling the source of its live version" },
  { key: "INSTALLING_DEPENDENCIES", label: "Installing packages", streams: true },
  { key: "SAVING_WORKSPACE", label: "Opening the workspace" },
];

// Failures another try won't get past: signed out, publishing off, the site
// gone, or its live version without its source.
const FINAL = new Set(["SIGNED_OUT", "PUBLISH_DISABLED", "SITE_NOT_FOUND", "NOT_FORKABLE"]);

// A version published before its source was kept has none to fork.
const NOT_FORKABLE = "Publish this site again to fork it";

/**
 * A site's Fork button. In a list, the click and the keys are its own, not
 * the row's it sits in.
 */
export const ForkButton = ({
  site,
  onFork,
  primary,
  tabIndex,
}: {
  site: PublishedSite;
  onFork: (site: PublishedSite) => void;
  primary?: boolean;
  tabIndex?: number;
}) => (
  <Btn
    small
    kind={primary ? "primary" : "outline"}
    tabIndex={tabIndex}
    disabled={!site.forkable}
    title={site.forkable ? undefined : NOT_FORKABLE}
    aria-label={`Fork ${site.title}`}
    onClick={(e) => {
      e.stopPropagation();
      onFork(site);
    }}
    onDoubleClick={(e) => e.stopPropagation()}
  >
    <Svg size={13}>{ic.fork}</Svg> Fork
  </Btn>
);

/**
 * `fork(site)` starts a fork and shows how it's going; `dialog` is where it
 * shows, to render once, outside any row. When it's done, the tab becomes the
 * new workspace.
 */
export const useFork = (): { fork: (site: PublishedSite) => void; dialog: ReactNode } => {
  const [site, setSite] = useState<PublishedSite | null>(null);
  // The dialog's words outlive `site`, which goes as it closes.
  const [shown, setShown] = useState<PublishedSite | null>(null);
  const switchWorkspace = useSwitchWorkspace();
  const { status, errorMessage, errorCode, npmLines, failedStep, isCreating, start, reset, cancel } = useForkSiteFlow({
    onSuccess: (workspace) => {
      // Brief moment so the last step is seen done before it closes.
      setTimeout(() => {
        setSite(null);
        reset();
        // In place of the site, if it was the one in the tab.
        void switchWorkspace(workspace.id);
      }, 600);
    },
  });

  const fork = (next: PublishedSite) => {
    if (isCreating || !next.forkable) return;
    setSite(next);
    setShown(next);
    start(next.id);
  };

  // Only once it has failed: one under way is stopped with Cancel.
  const close = () => {
    if (isCreating || status === "done") return;
    setSite(null);
    reset();
  };

  // Main stops it and removes what it had made. By the time the workspace is
  // being saved it's as good as made, so there's nothing left to cancel.
  const cancellable = isCreating && status !== "SAVING_WORKSPACE";
  const stop = () => {
    cancel();
    setSite(null);
  };

  const dialog = (
    <Dialog open={!!site} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={status === "error"}
        className="bg-[#2c2c2c] border-[#2d2d2d] text-[#e0e0e0] font-sans antialiased"
        onEscapeKeyDown={(e) => status !== "error" && e.preventDefault()}
        onPointerDownOutside={(e) => status !== "error" && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-medium text-[#e0e0e0] tracking-[-0.01em]">
            <Svg size={15} className="shrink-0">
              {ic.fork}
            </Svg>
            <span className="min-w-0 truncate">Forking {shown?.title}</span>
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#9a9a9a] leading-[1.6]">
            Your own copy, as a new workspace on this Mac. The published site stays as it is.
          </DialogDescription>
        </DialogHeader>
        {shown && (
          <CreateWorkspaceProgress
            steps={steps}
            status={status}
            lines={npmLines}
            failedStep={failedStep}
            errorMessage={errorMessage}
            onRetry={errorCode && FINAL.has(errorCode) ? undefined : () => start(shown.id)}
            doneLabel="Workspace forked"
          />
        )}
        {cancellable && (
          <div className="flex justify-end">
            <Btn small kind="outline" onClick={stop}>
              Cancel
            </Btn>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );

  return { fork, dialog };
};
