import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

const OnboardingLayout = () => <Outlet />;

export const Route = createFileRoute("/_onboarding")({
  beforeLoad: ({ context }) => {
    if (context.claudeCodeAuth.authenticated) {
      throw redirect({ to: "/" });
    }
  },
  component: OnboardingLayout,
});
