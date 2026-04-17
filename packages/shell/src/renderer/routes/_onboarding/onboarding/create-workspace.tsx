import { useState, useEffect, useRef } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  IconCircleCheckFilled,
  IconCircleHalf2,
} from "@tabler/icons-react";
import { cn } from "@/renderer/lib/utils";
import { useCreateWorkspace } from "@/renderer/lib/workspace-ops";

type Status =
  | "idle"
  | "CREATING_DIRECTORY"
  | "SCAFFOLDING_PROJECT"
  | "INSTALLING_DEPENDENCIES"
  | "SAVING_WORKSPACE"
  | "done"
  | "error";

const STEPS = [
  { key: "CREATING_DIRECTORY", label: "Creating directory" },
  { key: "SCAFFOLDING_PROJECT", label: "Scaffolding project" },
  { key: "INSTALLING_DEPENDENCIES", label: "Installing dependencies" },
  { key: "SAVING_WORKSPACE", label: "Saving workspace" },
] as const;

const stepIndex = (s: Status): number => {
  const idx = STEPS.findIndex((st) => st.key === s);
  return s === "done" ? STEPS.length : idx;
};

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

const ICON_SIZE = 18;

const StepItem = ({
  step,
  isDone,
  isActive,
}: {
  step: (typeof STEPS)[number];
  isDone: boolean;
  isActive: boolean;
}) => (
  <div
    className={cn(
      "flex items-center gap-2.5 py-2.5 transition-opacity duration-300",
      isDone || isActive ? "opacity-100" : "opacity-35",
    )}
  >
    <div className="flex shrink-0">
      {isDone ? (
        <IconCircleCheckFilled
          size={ICON_SIZE}
          strokeWidth={1.75}
          color="#7c6cd6"
        />
      ) : isActive ? (
        <IconCircleHalf2
          size={ICON_SIZE}
          strokeWidth={1.75}
          color="#e8a040"
          className="animate-spin"
        />
      ) : (
        <IconCircleHalf2
          size={ICON_SIZE}
          strokeWidth={1.75}
          color="#6b6b6b"
        />
      )}
    </div>
    <span
      className={cn(
        "text-[13px]",
        isDone || isActive ? "text-[#e0e0e0]" : "text-[#666]",
        isActive ? "font-medium" : "font-normal",
      )}
    >
      {step.label}
    </span>
  </div>
);

const CreateWorkspacePage = () => {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const isCreating = status !== "idle" && status !== "done" && status !== "error";
  const current = stepIndex(status);
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
              {STEPS.map((step, i) => (
                <StepItem
                  key={step.key}
                  step={step}
                  isDone={status === "done" || current > i}
                  isActive={status !== "done" && current === i}
                />
              ))}

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
