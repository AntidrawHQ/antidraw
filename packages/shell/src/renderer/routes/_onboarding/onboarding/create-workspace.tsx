import { createFileRoute } from "@tanstack/react-router";

const CreateWorkspacePage = () => {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-neutral-400">Create Workspace</p>
    </div>
  );
};

export const Route = createFileRoute(
  "/_onboarding/onboarding/create-workspace",
)({
  component: CreateWorkspacePage,
});
