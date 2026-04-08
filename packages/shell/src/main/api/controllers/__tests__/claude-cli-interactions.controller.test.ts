import { describe, test, vi, expect, beforeEach } from "vitest";
import { execFile } from "child_process";
import { claudeCliInteractionsController } from "@/main/api/controllers/claude-cli-interactions.controller";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

// Real `claude auth status` JSON output (verified against CLI source 2026-04-08):
//
// Authenticated (exit 0):
//   { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty",
//     email, orgId, orgName, subscriptionType }
//
// Not authenticated (exit 1):
//   { loggedIn: false, authMethod: "none", apiProvider: "none" }
//   Note: email/orgId/orgName/subscriptionType absent when authMethod !== "claude.ai"
//
// CLI not installed:
//   shell: true  → error.code = 127 (number), stdout = ""   [current behavior — bug]
//   shell: false → error.code = "ENOENT", stdout = ""       [correct behavior post-fix]

const mockExecFile = (stdout: string, error: Error | null = null) => {
  vi.mocked(execFile).mockImplementationOnce((...args: Parameters<typeof execFile>) => {
    const callback = args[args.length - 1] as (
      error: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    callback(error, stdout, "");
    return {} as ReturnType<typeof execFile>;
  });
};

describe("GET /auth/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns authenticated status when logged in via claude.ai subscription", async () => {
    mockExecFile(
      JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        apiProvider: "firstParty",
        email: "user@example.com",
        orgId: "31784777-ad2e-4cfa-989b-b04d8e078cd0",
        orgName: "Test Org",
        subscriptionType: "pro",
      }),
    );

    const res = await claudeCliInteractionsController.request("/auth/status");

    expect(res.status).toMatchInlineSnapshot(`200`);
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "authenticated": true,
        "cliInstalled": true,
        "email": "user@example.com",
        "orgName": "Test Org",
      }
    `);
  });

  test("returns authenticated status when logged in via API key", async () => {
    mockExecFile(
      JSON.stringify({
        loggedIn: true,
        authMethod: "api_key",
        apiProvider: "firstParty",
        apiKeySource: "ANTHROPIC_API_KEY",
      }),
    );

    const res = await claudeCliInteractionsController.request("/auth/status");

    expect(res.status).toMatchInlineSnapshot(`200`);
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "authenticated": true,
        "cliInstalled": true,
        "email": null,
        "orgName": null,
      }
    `);
  });

  test("returns cliInstalled: false when claude CLI is not installed", async () => {
    const error = Object.assign(new Error("spawn claude ENOENT"), {
      code: "ENOENT",
    });
    mockExecFile("", error);

    const res = await claudeCliInteractionsController.request("/auth/status");

    expect(res.status).toMatchInlineSnapshot(`200`);
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "authenticated": false,
        "cliInstalled": false,
        "email": null,
        "orgName": null,
      }
    `);
  });

  test("returns unauthenticated status when claude is not logged in", async () => {
    const error = Object.assign(new Error("Command failed: claude auth status"), {
      code: 1,
    });
    mockExecFile(
      JSON.stringify({
        loggedIn: false,
        authMethod: "none",
        apiProvider: "firstParty",
      }),
      error,
    );

    const res = await claudeCliInteractionsController.request("/auth/status");

    expect(res.status).toMatchInlineSnapshot(`200`);
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "authenticated": false,
        "cliInstalled": true,
        "email": null,
        "orgName": null,
      }
    `);
  });

  test("returns unauthenticated with cliInstalled: true on non-zero exit with unparseable stdout", async () => {
    const error = Object.assign(new Error("Command failed: claude auth status"), {
      code: 1,
    });
    mockExecFile("not json", error);

    const res = await claudeCliInteractionsController.request("/auth/status");

    expect(res.status).toMatchInlineSnapshot(`200`);
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "authenticated": false,
        "cliInstalled": true,
        "email": null,
        "orgName": null,
      }
    `);
  });

  test("returns 500 when exit 0 produces unparseable stdout", async () => {
    mockExecFile("not json");

    const res = await claudeCliInteractionsController.request("/auth/status");

    expect(res.status).toMatchInlineSnapshot(`500`);
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": {
          "code": "AUTH_CHECK_FAILED",
          "message": "Failed to parse claude auth status output: not json",
        },
      }
    `);
  });
});
