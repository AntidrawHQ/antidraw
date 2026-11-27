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

const steps = (site: PublishedSite): ProgressStep<ForkStatus>[] => [
  { key: "FETCHING_SOURCE", label: `Pulling the source of v${site.version}` },
  { key: "INSTALLING_DEPENDENCIES", label: "Installing packages", streams: true },
  { key: "SAVING_WORKSPACE", label: "Opening the workspace" },
];

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
  const { status, errorMessage, npmLines, failedStep, isCreating, start, reset } = useForkSiteFlow({
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

  // Only once it has failed: there's no stopping a fork under way.
  const close = () => {
    if (isCreating || status === "done") return;
    setSite(null);
    reset();
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
            steps={steps(shown)}
            status={status}
            lines={npmLines}
            failedStep={failedStep}
            errorMessage={errorMessage}
            onRetry={() => start(shown.id)}
            doneLabel="Workspace forked"
          />
        )}
      </DialogContent>
    </Dialog>
  );

  return { fork, dialog };
};
