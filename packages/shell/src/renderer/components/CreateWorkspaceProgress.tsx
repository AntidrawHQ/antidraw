import {
  IconCircleCheckFilled,
  IconCircleHalf2,
} from "@tabler/icons-react";
import { cn } from "@/renderer/lib/utils";
import type { CreateWorkspaceStatus } from "@/renderer/lib/use-create-workspace-flow";

export const CREATE_WORKSPACE_STEPS = [
  { key: "CREATING_DIRECTORY", label: "Creating directory" },
  { key: "SCAFFOLDING_PROJECT", label: "Scaffolding project" },
  { key: "INSTALLING_DEPENDENCIES", label: "Installing dependencies" },
  { key: "SAVING_WORKSPACE", label: "Saving workspace" },
] as const;

export const createWorkspaceStepIndex = (s: CreateWorkspaceStatus): number => {
  const idx = CREATE_WORKSPACE_STEPS.findIndex((st) => st.key === s);
  return s === "done" ? CREATE_WORKSPACE_STEPS.length : idx;
};

const ICON_SIZE = 18;

const StepItem = ({
  step,
  isDone,
  isActive,
}: {
  step: (typeof CREATE_WORKSPACE_STEPS)[number];
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

export const CreateWorkspaceProgress = ({
  status,
}: {
  status: CreateWorkspaceStatus;
}) => {
  const current = createWorkspaceStepIndex(status);
  return (
    <div className="flex flex-col">
      {CREATE_WORKSPACE_STEPS.map((step, i) => (
        <StepItem
          key={step.key}
          step={step}
          isDone={status === "done" || current > i}
          isActive={status !== "done" && current === i}
        />
      ))}
    </div>
  );
};
