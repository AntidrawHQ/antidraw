import { useState, useEffect, useRef } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCreateWorkspace } from "@/renderer/lib/workspace-ops";
import {
  CreateWorkspaceProgress,
  type CreateWorkspaceStatus,
} from "@/renderer/components/CreateWorkspaceProgress";

const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M6 3l5 5-5 5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CreateWorkspacePage = () => {
  const router = useRouter();
  const [status, setStatus] = useState<CreateWorkspaceStatus>("idle");
  const isCreating = status !== "idle" && status !== "done" && status !== "error";
  const { mutate: createWorkspace } = useCreateWorkspace();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    createWorkspace(
      {
        name: "Default Workspace",
        onProgress: (event) => {
          if (event.type === "status") {
            setStatus(event.status);
          }
          if (event.type === "done") {
            setStatus("done");
          }
          if (event.type === "error") {
            setStatus("error");
          }
        },
      },
    );
  }, [createWorkspace]);

  const handleOpenWorkspace = () => {
    router.navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen w-full flex items-start justify-center bg-neutral-800 font-sans antialiased p-6 pt-16 cursor-default">
      <div className="flex flex-col max-w-[540px] w-full">
        <h1 className="text-[28px] font-medium text-[#e0e0e0] m-0 tracking-[-0.04em]">
          {status === "done"
            ? "Workspace ready"
            : "Setting up your first workspace"}
        </h1>
        <p className="text-sm text-[#9a9a9a] mt-2.5 leading-[1.6]">
          {status === "done" ? (
            <>
              Your workspace has been set up
              <br />
              and is ready to use.
            </>
          ) : (
            <>
              Everything is real code in Antidraw.
              <br />
              You design in code. There is no handoff.
            </>
          )}
        </p>

        {(isCreating || status === "done") && (
          <div className="flex items-end gap-4 mt-6 animate-[onb-fadein_0.3s_ease]">
            <div className="flex flex-col flex-1 min-w-0">
              <CreateWorkspaceProgress status={status} />

              <button
                onClick={handleOpenWorkspace}
                disabled={status !== "done"}
                className="mt-6 w-fit flex items-center justify-center gap-2 px-4 py-2 rounded-[10px] border border-white/[0.12] hover:border-white/[0.24] bg-white/[0.08] hover:bg-white/[0.12] text-[#ccc] text-sm font-medium cursor-pointer disabled:cursor-default disabled:pointer-events-none transition-all duration-200 opacity-100 disabled:opacity-0"
              >
                Open workspace <ArrowRightIcon />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_onboarding/onboarding/create-workspace")({
  component: CreateWorkspacePage,
});
