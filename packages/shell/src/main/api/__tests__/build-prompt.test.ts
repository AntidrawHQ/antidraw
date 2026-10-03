import { describe, test, expect } from "vitest";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildPrompt } from "@/main/api/claude-code-ops";

const drain = async (stream: AsyncIterable<SDKUserMessage>, n: number) => {
  const out: SDKUserMessage[] = [];
  for await (const m of stream) {
    out.push(m);
    if (out.length === n) break;
  }
  return out;
};

describe("buildPrompt", () => {
  test("the seed message is queued for the reader", async () => {
    const uuid = crypto.randomUUID();
    const prompt = buildPrompt("hello", { uuid });
    const [seed] = await drain(prompt.prompt, 1);
    expect(seed!.uuid).toBe(uuid);
  });

  test("pushes queue ahead of any reader and keep their uuids", async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const prompt = buildPrompt("seed", { uuid: ids[0] });
    prompt.push("second", { uuid: ids[1] });
    prompt.push("third", { uuid: ids[2] });

    const got = await drain(prompt.prompt, 3);
    expect(got.map((m) => m.uuid)).toEqual(ids);
  });

  test("pushing to a closed stream reports failure instead of dropping it", () => {
    const prompt = buildPrompt("seed", { uuid: crypto.randomUUID() });
    prompt.end();
    // A silent no-op here is what left a message marked "Queued" forever:
    // it never reaches the CLI, so it is never acked and nothing clears it.
    const pushed = prompt.push("late", { uuid: crypto.randomUUID() });
    expect(pushed.isErr()).toBe(true);
    expect(pushed._unsafeUnwrapErr()).toBe("STREAM_CLOSED");
  });

  test("a push that lands reports success", () => {
    const prompt = buildPrompt("seed", { uuid: crypto.randomUUID() });
    expect(prompt.push("second", { uuid: crypto.randomUUID() }).isOk()).toBe(true);
  });

  test("end is idempotent", () => {
    const prompt = buildPrompt("seed", { uuid: crypto.randomUUID() });
    prompt.end();
    expect(() => prompt.end()).not.toThrow();
  });
});
