import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/onboarding/claude-code")({
  component: ClaudeCodePage,
});

const ClaudeCodePage = () => {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-neutral-400">Claude Code Setup</p>
    </div>
  );
};
