import { createFileRoute, Outlet } from "@tanstack/react-router";

const AuthedLayout = () => <Outlet />;

export const Route = createFileRoute("/_authed")({
  // TODO: PR #17 will add workspace existence check here:
  // no workspaces → redirect to /onboarding/create-workspace
  component: AuthedLayout,
});
