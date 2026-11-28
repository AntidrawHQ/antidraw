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
import { track } from "@/renderer/lib/analytics";
import { cn } from "@/renderer/lib/utils";
import { CoversCanvas } from "@/renderer/lib/thumbnail";
import {
  useCloseWorkspace,
  useDeleteWorkspace,
  useSwitchWorkspace,
  useWorkspaces,
} from "@/renderer/lib/workspace-ops";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { Header } from "./Header";
import { ListRows, RowMenu, SORTERS, type Sort } from "./LocalList";

// The Dashboard tab: the workspaces on this Mac. Opening one puts it in the
// window's other tab, in place of what was there. Drawn over the open
// workspace, which keeps running under it (see App.tsx).

// How the list is sorted, kept while the window is open: the dashboard is
// unmounted whenever the other tab is the one showing.
export const useDashboardStore = create<{
  sort: Sort;
  setSort: (sort: Sort) => void;
}>((set) => ({
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

export const Dashboard = () => {
  const { data: workspaces = [] } = useWorkspaces();
  const switchWorkspace = useSwitchWorkspace();
  const { sort, setSort } = useDashboardStore();
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
          sections={["local"]}
          section="local"
          onSection={() => {}}
          counts={{ local: workspaces.length }}
          query={query}
          onQuery={setQuery}
          sort={sort}
          onSort={setSort}
          onNew={() => setCreating(true)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" onClick={deselect}>
        <div className={cn(COLUMN, "pb-16")} onClick={deselect}>
          {items.length === 0 ? (
            <div className="py-24 text-center text-[14px] text-[#9B9B9B]">
              {q ? `Nothing matches “${query}”.` : "No workspaces yet."}
            </div>
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
