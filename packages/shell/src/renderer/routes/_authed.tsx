import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

const AuthedLayout = () => <Outlet />;

export const Route = createFileRoute("/_authed")({
  beforeLoad: ({ context }) => {
    if (!context.claudeCodeAuth.authenticated) {
      throw redirect({ to: "/onboarding/claude-code" });
    }
    // TODO: PR #17 will add workspace existence check here:
    // no workspaces → redirect to /onboarding/create-workspace
  },
  component: AuthedLayout,
});
