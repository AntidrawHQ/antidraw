import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/renderer/components/ui/dialog";
import { ThemedInput } from "@/renderer/components/ui/themed-input";
import { Button } from "@/renderer/components/ui/button";
import { useSwitchWorkspace } from "@/renderer/lib/workspace-ops";
import { useCreateWorkspaceFlow } from "@/renderer/lib/use-create-workspace-flow";
import { CreateWorkspaceProgress } from "@/renderer/components/CreateWorkspaceProgress";

type CreateWorkspaceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const CreateWorkspaceDialog = ({
  open,
  onOpenChange,
}: CreateWorkspaceDialogProps) => {
  const [name, setName] = useState("");
  const switchWorkspace = useSwitchWorkspace();

  const {
    status,
    errorMessage,
    npmLines,
    failedStep,
    isCreating,
    isPending,
    start,
    reset,
  } = useCreateWorkspaceFlow({
      onSuccess: (workspace) => {
        switchWorkspace(workspace.id);
        // Brief moment so user sees the final "done" state before close
        setTimeout(() => {
          onOpenChange(false);
          setName("");
          reset();
        }, 600);
      },
    });

  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !isPending;

  const handleOpenChange = (next: boolean) => {
    // Block close while creation is in flight
    if (!next && isCreating) return;
    if (!next) {
      setName("");
      reset();
    }
    onOpenChange(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    start(trimmedName);
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

        {status === "idle" ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <ThemedInput
              autoFocus
              placeholder="Workspace name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isCreating}
            />

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
            <CreateWorkspaceProgress
              status={status}
              lines={npmLines}
              failedStep={failedStep}
              errorMessage={errorMessage}
              onRetry={() => start(trimmedName)}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
