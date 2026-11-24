import { useMemo, useState } from "react";
import { create } from "zustand";
import type { WorkspaceWithThumbnail } from "@/main/api";
import { CreateWorkspaceDialog } from "@/renderer/components/CreateWorkspaceDialog";
import { Button } from "@/renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/renderer/components/ui/dialog";
import {
  useCancelSignIn,
  useFeatures,
  usePublishedSites,
  useSignIn,
} from "@/renderer/lib/account-ops";
import { track } from "@/renderer/lib/analytics";
import { cn } from "@/renderer/lib/utils";
import { CoversCanvas } from "@/renderer/lib/thumbnail";
import {
  useCloseWorkspace,
  useDeleteWorkspace,
  useOpenPublished,
  useSwitchWorkspace,
  useWorkspaces,
} from "@/renderer/lib/workspace-ops";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { Header, type Section } from "./Header";
import { ListRows, RowMenu, SORTERS, type Sort } from "./LocalList";
import { PublishedRows } from "./PublishedList";
import { Btn } from "./kit";

// The Dashboard tab: the workspaces on this Mac (Local), and what the account
// has published (Published, where publishing is on). Opening one puts it in
// the window's other tab, in place of what was there: a workspace as itself,
// a published site view-only. Drawn over what that tab holds, which keeps
// running under it (see App.tsx).

// Which section is up and how Local is sorted, kept while the window is
// open: the dashboard is unmounted whenever the other tab is the one showing.
export const useDashboardStore = create<{
  section: Section;
  setSection: (section: Section) => void;
  sort: Sort;
  setSort: (sort: Sort) => void;
}>((set) => ({
  section: "local",
  setSection: (section) => set({ section }),
  sort: "active",
  setSort: (sort) => set({ sort }),
}));

// The dashboard's one column, centred.
const COLUMN = "mx-auto max-w-[1040px] px-[clamp(32px,5vw,72px)]";

const DeleteWorkspaceDialog = ({
  workspace,
  onClose,
}: {
  workspace: WorkspaceWithThumbnail | null;
  onClose: () => void;
}) => {
  const closeWorkspace = useCloseWorkspace();
  const { mutate, isPending, error, reset } = useDeleteWorkspace();
  // The dialog's words outlive `workspace`, which goes as it closes.
  const [shown, setShown] = useState(workspace);
  if (workspace && workspace !== shown) setShown(workspace);
  // From the click on, not only once the delete is sent: closing its tab
  // comes first, and a Cancel then wouldn't stop the delete.
  const [closingTab, setClosingTab] = useState(false);
  const busy = closingTab || isPending;

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const remove = async () => {
    if (!workspace || busy) return;
    // Its dev server stops before its files go.
    if (workspace.id === useWorkspaceStore.getState().activeWorkspaceId) {
      setClosingTab(true);
      try {
        await closeWorkspace();
      } finally {
        setClosingTab(false);
      }
    }
    mutate(workspace.id, { onSuccess: onClose });
  };

  return (
    <Dialog open={!!workspace} onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className="bg-[#2c2c2c] border-[#2d2d2d] text-[#e0e0e0] font-sans antialiased"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-medium text-[#e0e0e0] tracking-[-0.01em]">
            Delete “{shown?.name}”?
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#9a9a9a] leading-[1.6]">
            Its components and chats are removed from this Mac. This can't be undone.
            {shown?.siteUrl && " What it published stays online."}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-[13px] text-[#f08a8a]">{error.message}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={close}
            disabled={busy}
            className="border-white/[0.12] bg-transparent text-[#ccc] hover:bg-white/[0.06] hover:text-[#e0e0e0]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="border border-[#f08a8a]/30 bg-[#f08a8a]/15 text-[#f08a8a] hover:bg-[#f08a8a]/25"
          >
            {busy ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// A line in place of a list, with what to do about it under it.
const Notice = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="flex flex-col items-center gap-4 py-24 text-center text-[14px] text-[#9B9B9B]">
    <span>{children}</span>
    {action}
  </div>
);

// The Published section: the account's sites, or why there's no list.
const Published = ({ query }: { query: string }) => {
  const { data: sites, error, isPending, refetch, isFetching } = usePublishedSites();
  const openPublished = useOpenPublished();
  const signIn = useSignIn();
  const cancelSignIn = useCancelSignIn();

  const q = query.trim().toLowerCase();
  const items = useMemo(
    () => (sites ?? []).filter((site) => !q || site.title.toLowerCase().includes(q)),
    [sites, q],
  );

  if (isPending) return <Notice>Loading…</Notice>;

  if (error?.code === "SIGNED_OUT") {
    return (
      <Notice
        action={
          signIn.isPending ? (
            // The browser has the sign-in; this ends the wait for it.
            <Btn kind="outline" onClick={() => cancelSignIn.mutate()}>
              Cancel
            </Btn>
          ) : (
            <Btn kind="secondary" onClick={() => signIn.mutate()}>
              Sign in
            </Btn>
          )
        }
      >
        {signIn.isPending
          ? "Finish signing in in your browser."
          : signIn.error && signIn.error.code !== "CANCELLED"
            ? signIn.error.message
            : "Sign in to see what you've published."}
      </Notice>
    );
  }
  if (error?.code === "PUBLISH_DISABLED") return <Notice>Publishing isn't available yet.</Notice>;
  // The list it had stays up over a failed refresh.
  if (error && !sites) {
    return (
      <Notice
        action={
          <Btn kind="secondary" disabled={isFetching} onClick={() => void refetch()}>
            Try again
          </Btn>
        }
      >
        {error.message}
      </Notice>
    );
  }

  if (items.length === 0) return <Notice>{q ? `Nothing matches “${query}”.` : "Nothing published yet."}</Notice>;
  return <PublishedRows items={items} onOpen={(site) => void openPublished(site)} />;
};

export const Dashboard = () => {
  const { data: workspaces = [] } = useWorkspaces();
  const switchWorkspace = useSwitchWorkspace();
  const { sort, setSort, setSection } = useDashboardStore();
  // Published is there where Publish is: for the accounts the server lets in.
  const { data: features } = useFeatures();
  const publishOn = features?.publish === true;
  const section = useDashboardStore((s) => (publishOn ? s.section : "local"));
  // Its count, once it's been listed; nothing is asked while it's not shown.
  const { data: sites } = usePublishedSites(publishOn);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ workspace: WorkspaceWithThumbnail; x: number; y: number } | null>(null);
  const [creating, setCreating] = useState(false);
  // Delete is held back for now; the dialog below is ready for it.
  // const [deleting, setDeleting] = useState<WorkspaceWithThumbnail | null>(null);

  const q = query.trim().toLowerCase();
  const items = useMemo(
    () => workspaces.filter((w) => !q || w.name.toLowerCase().includes(q)).sort(SORTERS[sort]),
    [workspaces, q, sort],
  );

  const open = (workspace: WorkspaceWithThumbnail) => {
    if (workspace.id !== useWorkspaceStore.getState().activeWorkspaceId)
      track("workspace_switched", { workspace_id: workspace.id });
    void switchWorkspace(workspace.id);
  };

  // A click on none of the rows (the space around them) leaves none selected.
  const deselect = (e: React.MouseEvent) => e.target === e.currentTarget && setSelected(null);

  // The header stays put and the list scrolls under it, the scrollbar at the
  // window's edge; both share one column.
  return (
    <main
      className="absolute inset-0 flex flex-col bg-[#222222] font-sans antialiased"
      onClick={deselect}
    >
      {/* No thumbnail is taken of the canvas under it. */}
      <CoversCanvas />
      <div className={cn(COLUMN, "w-full shrink-0 pt-12")} onClick={deselect}>
        <Header
          sections={publishOn ? ["local", "published"] : ["local"]}
          section={section}
          onSection={(to) => {
            setSection(to);
            setQuery("");
            setSelected(null);
          }}
          counts={{ local: workspaces.length, published: sites?.length }}
          query={query}
          onQuery={setQuery}
          sort={sort}
          onSort={setSort}
          onNew={() => setCreating(true)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" onClick={deselect}>
        <div className={cn(COLUMN, "pb-16")} onClick={deselect}>
          {section === "published" ? (
            <Published query={query} />
          ) : items.length === 0 ? (
            <Notice>{q ? `Nothing matches “${query}”.` : "No workspaces yet."}</Notice>
          ) : (
            <ListRows
              items={items}
              selected={selected}
              onSelect={setSelected}
              onOpen={open}
              onMenu={(workspace, x, y) => setMenu({ workspace, x, y })}
            />
          )}
        </div>
      </div>

      {menu && (
        <RowMenu
          x={menu.x}
          y={menu.y}
          onOpen={() => open(menu.workspace)}
          // onDelete={() => setDeleting(menu.workspace)}
          onClose={() => setMenu(null)}
        />
      )}
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} />
      {/* <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} /> */}
    </main>
  );
};
