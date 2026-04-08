import { execFile } from "child_process";
import { ok, err, type Result } from "neverthrow";

export type ClaudeAuthStatus = {
  authenticated: boolean;
  email: string | null;
  orgName: string | null;
  cliInstalled: boolean;
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

export const checkClaudeAuthStatus = (): Promise<
  Result<ClaudeAuthStatus, ClaudeCliError>
> => {
  return new Promise((resolve) => {
    execFile(
      "claude",
      ["auth", "status"],
      { timeout: 5_000 },
      (error, stdout) => {
        if (error) {
          // CLI not found
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            resolve(
              ok({
                authenticated: false,
                email: null,
                orgName: null,
                cliInstalled: false,
              }),
            );
            return;
          }

          // Non-zero exit — try parsing stdout in case it's structured JSON
          try {
            const parsed = JSON.parse(stdout);
            resolve(
              ok({
                authenticated: parsed.loggedIn === true,
                email: parsed.email ?? null,
                orgName: parsed.orgName ?? null,
                cliInstalled: true,
              }),
            );
          } catch {
            resolve(
              ok({
                authenticated: false,
                email: null,
                orgName: null,
                cliInstalled: true,
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
              cliInstalled: true,
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
