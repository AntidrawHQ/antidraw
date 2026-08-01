import { execFile } from "child_process";
import { ok, err, type Result } from "neverthrow";
import { claudeCodeExecutablePath } from "@/main/api/claude-code-ops";

const ClaudeCliErrorCode = {
  AUTH_CHECK_FAILED: "AUTH_CHECK_FAILED",
} as const;

type ClaudeCliErrorCode =
  (typeof ClaudeCliErrorCode)[keyof typeof ClaudeCliErrorCode];

type ClaudeCliError = {
  status: 500;
  code: ClaudeCliErrorCode;
  message: string;
};

// The SDK ships the CLI as a native platform binary (optionalDependencies,
// e.g. @anthropic-ai/claude-agent-sdk-darwin-arm64/claude) — the old cli.js
// JS entry no longer exists, so no node shim is needed to run it.
const getBundledCliPath = (): Result<string, ClaudeCliError> => {
  if (!claudeCodeExecutablePath) {
    return err({
      status: 500,
      code: ClaudeCliErrorCode.AUTH_CHECK_FAILED,
      message: "Bundled Claude Code binary not found for this platform",
    });
  }
  return ok(claudeCodeExecutablePath);
};

export const triggerClaudeLogin = (): Promise<
  Result<{ triggered: boolean }, ClaudeCliError>
> => {
  return new Promise((resolve) => {
    const cliPath = getBundledCliPath();
    if (cliPath.isErr()) {
      resolve(err(cliPath.error));
      return;
    }
    const escapedCliPath = cliPath.value.replace(/"/g, '\\"');
    const command = `\\"${escapedCliPath}\\" auth login`;

    execFile(
      "osascript",
      [
        "-e", `tell application "Terminal"`,
        "-e", `activate`,
        "-e", `do script "${command}"`,
        "-e", `end tell`,
      ],
      { timeout: 10_000 },
      (error) => {
        if (error) {
          resolve(
            err({
              status: 500,
              code: ClaudeCliErrorCode.AUTH_CHECK_FAILED,
              message: `Failed to open Terminal for login: ${error.message}`,
            }),
          );
          return;
        }
        resolve(ok({ triggered: true }));
      },
    );
  });
};
