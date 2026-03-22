import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/onboarding/create-workspace")({
  component: CreateWorkspacePage,
});

const CreateWorkspacePage = () => {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-neutral-400">Create Workspace</p>
    </div>
  );
};
