import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { workspacesQueryOptions } from "@/renderer/lib/workspace-queries";

const AuthedLayout = () => <Outlet />;

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ context }) => {
    const workspaces = await context.queryClient.ensureQueryData(
      workspacesQueryOptions,
    );
    if (workspaces.length === 0) {
      throw redirect({ to: "/onboarding/create-workspace" });
    }
  },
  component: AuthedLayout,
});
