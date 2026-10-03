import { describe, test, vi, expect, beforeEach } from "vitest";
import { execFile } from "child_process";
import { claudeCliInteractionsController } from "@/main/api/controllers/claude-cli-interactions.controller";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

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

describe("POST /auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("launches the Terminal login and reports triggered", async () => {
    mockExecFile("");

    const res = await claudeCliInteractionsController.request("/auth/login", {
      method: "POST",
    });

    expect(res.status).toMatchInlineSnapshot(`200`);
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "triggered": true,
      }
    `);
  });

  test("runs the SDK's bundled native binary via osascript", async () => {
    mockExecFile("");

    await claudeCliInteractionsController.request("/auth/login", {
      method: "POST",
    });

    const [file, args] = vi.mocked(execFile).mock.calls[0] as unknown as [
      string,
      string[],
    ];
    expect(file).toBe("osascript");
    const script = args.join(" ");
    // The SDK no longer ships a cli.js — the command must point at the
    // native platform binary and need no node shim.
    expect(script).toContain("auth login");
    expect(script).not.toContain("cli.js");
    expect(script).toContain("claude-agent-sdk-");
  });

  test("returns 500 when the Terminal launch fails", async () => {
    mockExecFile("", new Error("osascript exploded"));

    const res = await claudeCliInteractionsController.request("/auth/login", {
      method: "POST",
    });

    expect(res.status).toMatchInlineSnapshot(`500`);
    expect(await res.json()).toMatchInlineSnapshot(`
      {
        "error": {
          "code": "AUTH_CHECK_FAILED",
          "message": "Failed to open Terminal for login: osascript exploded",
        },
      }
    `);
  });
});
