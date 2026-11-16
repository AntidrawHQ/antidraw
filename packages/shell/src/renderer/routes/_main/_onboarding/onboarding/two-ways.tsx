import { createFileRoute, useRouter } from "@tanstack/react-router";
import { OnboardingTwoWays } from "@/renderer/onboarding/OnboardingTwoWays";

const TwoWaysPage = () => {
  const router = useRouter();
  return <OnboardingTwoWays onOpenWorkspace={() => router.navigate({ to: "/" })} />;
};

export const Route = createFileRoute("/_main/_onboarding/onboarding/two-ways")({
  component: TwoWaysPage,
});
