import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/renderer/components/ui/dialog";
import { Input } from "@/renderer/components/ui/input";
import { Button } from "@/renderer/components/ui/button";
import { useCreateWorkspace } from "@/renderer/lib/workspace-ops";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import {
  CreateWorkspaceProgress,
  type CreateWorkspaceStatus,
} from "@/renderer/components/CreateWorkspaceProgress";

type CreateWorkspaceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const CreateWorkspaceDialog = ({
  open,
  onOpenChange,
}: CreateWorkspaceDialogProps) => {
  const [name, setName] = useState("");
  const [status, setStatus] = useState<CreateWorkspaceStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const setActiveWorkspaceId = useWorkspaceStore(
    (s) => s.setActiveWorkspaceId,
  );
  const setActiveConversationId = useWorkspaceStore(
    (s) => s.setActiveConversationId,
  );

  const { mutate: createWorkspace } = useCreateWorkspace();

  const isCreating =
    status !== "idle" && status !== "done" && status !== "error";
  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && status === "idle";

  const reset = () => {
    setName("");
    setStatus("idle");
    setErrorMessage(null);
  };

  const handleOpenChange = (next: boolean) => {
    // Block close while creation is in flight
    if (!next && isCreating) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setErrorMessage(null);
    createWorkspace(
      {
        name: trimmedName,
        onProgress: (event) => {
          if (event.type === "status") setStatus(event.status);
          if (event.type === "done") setStatus("done");
          if (event.type === "error") {
            setStatus("error");
            setErrorMessage(event.error.message);
          }
        },
      },
      {
        onSuccess: (workspace) => {
          setActiveWorkspaceId(workspace.id);
          setActiveConversationId(null);
          // Brief moment so user sees the final "done" state before close
          setTimeout(() => {
            onOpenChange(false);
            reset();
          }, 600);
        },
        onError: (err) => {
          setStatus("error");
          setErrorMessage(err.message);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={!isCreating}
        className="bg-[#2c2c2c] border-[#2d2d2d] text-[#e0e0e0] font-sans antialiased"
        onEscapeKeyDown={(e) => {
          if (isCreating) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (isCreating) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-medium text-[#e0e0e0] tracking-[-0.01em]">
            Create workspace
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#9a9a9a] leading-[1.6]">
            Give your new workspace a name. We'll scaffold the project and
            install dependencies.
          </DialogDescription>
        </DialogHeader>

        {status === "idle" || status === "error" ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <Input
              autoFocus
              placeholder="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10 rounded-lg border-white/[0.10] bg-transparent px-3 text-[13px] text-[#e0e0e0] placeholder:text-neutral-500"
              disabled={isCreating}
            />

            {errorMessage && (
              <p className="text-sm text-destructive">{errorMessage}</p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                className="border-white/[0.12] bg-transparent text-[#ccc] hover:bg-white/[0.06] hover:text-[#e0e0e0]"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!canSubmit}
                className="border border-white/[0.12] bg-white/[0.08] text-[#e0e0e0] hover:bg-white/[0.12]"
              >
                Create
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex flex-col">
            <CreateWorkspaceProgress status={status} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
