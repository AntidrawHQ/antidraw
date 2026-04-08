import { createFileRoute } from "@tanstack/react-router";

const ClaudeCodePage = () => {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-neutral-400">Claude Code Setup</p>
    </div>
  );
};

export const Route = createFileRoute("/_onboarding/onboarding/claude-code")({
  component: ClaudeCodePage,
});
