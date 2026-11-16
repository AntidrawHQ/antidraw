import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Query } from "@anthropic-ai/claude-agent-sdk";

// A packaged app, so analytics is on, with its userData in a temp dir.
let userData = "";
vi.mock("electron", () => ({
  app: {
    isPackaged: true,
    getVersion: () => "9.9.9-test",
    getPath: () => userData,
  },
}));

const capture = vi.fn();
const alias = vi.fn();
vi.mock("posthog-node", () => ({
  PostHog: class {
    capture = capture;
    alias = alias;
    shutdown = vi.fn();
  },
}));

// Each test gets a fresh module: the client and the install id are cached in it.
const load = async () => {
  vi.resetModules();
  return import("../posthog");
};

const queryWith = (account: unknown): Query =>
  ({ initializationResult: async () => ({ account }) }) as unknown as Query;

// The one event captured so far.
const captured = () => {
  const call = capture.mock.calls[0];
  if (!call) throw new Error("nothing was captured");
  return call[0];
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const installId = () =>
  (JSON.parse(fs.readFileSync(path.join(userData, "analytics.json"), "utf-8")) as { installId: string }).installId;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), "posthog-test-"));
  capture.mockReset();
  alias.mockReset();
});

afterEach(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe("trackMessageSent", () => {
  it("sends a signed-in message under the account's email and aliases the install to it", async () => {
    const { trackMessageSent } = await load();
    trackMessageSent({ query: queryWith({ email: "a@example.com", subscriptionType: "Claude Pro" }) });
    await settle();

    expect(alias).toHaveBeenCalledWith({ distinctId: "a@example.com", alias: installId() });
    expect(capture).toHaveBeenCalledTimes(1);
    const event = captured();
    expect(event.distinctId).toBe("a@example.com");
    expect(event.event).toBe("message_sent");
    expect(event.properties.signed_in).toBe(true);
    expect(event.properties.$set.subscription_type).toBe("Claude Pro");
  });

  it("still counts a message sent without signing in, under the install id", async () => {
    const { trackMessageSent } = await load();
    trackMessageSent({ query: queryWith({}) });
    await settle();

    expect(alias).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
    const event = captured();
    expect(event.distinctId).toBe(installId());
    expect(event.event).toBe("message_sent");
    expect(event.properties.signed_in).toBe(false);
    expect(event.properties.$set.email).toBeUndefined();
  });

  it("counts it as signed out when the account can't be read", async () => {
    const { trackMessageSent } = await load();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const query = {
      initializationResult: async () => {
        throw new Error("CLI exited");
      },
    } as unknown as Query;
    trackMessageSent({ query });
    await settle();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(captured().properties.signed_in).toBe(false);
  });
});

describe("trackAgentError", () => {
  it("sends the SDK's error code for an assistant error, and nothing else", async () => {
    const { trackAgentError } = await load();

    expect(trackAgentError({ type: "assistant", error: "authentication_failed" })).toBe(true);
    expect(trackAgentError({ type: "assistant" })).toBe(false);
    expect(trackAgentError({ type: "result", error: "unknown" })).toBe(false);

    expect(capture).toHaveBeenCalledTimes(1);
    const event = captured();
    expect(event.event).toBe("agent_error");
    expect(event.distinctId).toBe(installId());
    expect(event.properties.error_code).toBe("authentication_failed");
  });
});
