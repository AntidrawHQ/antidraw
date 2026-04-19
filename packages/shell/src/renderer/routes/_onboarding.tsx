import { createFileRoute, Outlet } from "@tanstack/react-router";

const OnboardingLayout = () => <Outlet />;

export const Route = createFileRoute("/_onboarding")({
  component: OnboardingLayout,
});
