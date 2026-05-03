import { execFile } from "child_process";
import { resolve, dirname } from "path";
import { createRequire } from "module";
import { ok, err, type Result } from "neverthrow";
import { getShimNodePath, getShimmedSpawnEnv } from "@/main/lib/node-shim";

export type ClaudeAuthStatus = {
  authenticated: boolean;
  email: string | null;
  orgName: string | null;
};

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

const getBundledCliPath = () => {
  const require = createRequire(import.meta.url);
  const sdkDir = dirname(
    require.resolve("@anthropic-ai/claude-agent-sdk"),
  );
  return resolve(sdkDir, "cli.js");
};

export const triggerClaudeLogin = (): Promise<
  Result<{ triggered: boolean }, ClaudeCliError>
> => {
  return new Promise((resolve) => {
    const cliPath = getBundledCliPath();
    const escapedCliPath = cliPath.replace(/"/g, '\\"');
    const escapedShimNode = getShimNodePath().replace(/"/g, '\\"');
    const escapedElectronPath = process.execPath.replace(/"/g, '\\"');
    // The Terminal subshell doesn't inherit our env, so bake ELECTRON_PATH
    // inline so the shim can re-exec the Electron binary as Node.
    const command = `ELECTRON_PATH=\\"${escapedElectronPath}\\" \\"${escapedShimNode}\\" \\"${escapedCliPath}\\" auth login`;

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

export const checkClaudeAuthStatus = (): Promise<
  Result<ClaudeAuthStatus, ClaudeCliError>
> => {
  return new Promise((resolve) => {
    const cliPath = getBundledCliPath();

    execFile(
      process.execPath,
      [cliPath, "auth", "status", "--json"],
      { timeout: 5_000, env: getShimmedSpawnEnv() },
      (error, stdout) => {
        if (error) {
          // Non-zero exit — try parsing stdout in case it's structured JSON
          try {
            const parsed = JSON.parse(stdout);
            resolve(
              ok({
                authenticated: parsed.loggedIn === true,
                email: parsed.email ?? null,
                orgName: parsed.orgName ?? null,
              }),
            );
          } catch {
            resolve(
              ok({
                authenticated: false,
                email: null,
                orgName: null,
              }),
            );
          }
          return;
        }

        // Exit 0 — parse JSON output
        try {
          const parsed = JSON.parse(stdout);
          resolve(
            ok({
              authenticated: parsed.loggedIn === true,
              email: parsed.email ?? null,
              orgName: parsed.orgName ?? null,
            }),
          );
        } catch {
          resolve(
            err({
              status: 500,
              code: ClaudeCliErrorCode.AUTH_CHECK_FAILED,
              message: `Failed to parse claude auth status output: ${stdout}`,
            }),
          );
        }
      },
    );
  });
};
