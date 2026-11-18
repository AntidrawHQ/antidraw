import { expect, it, vi } from "vitest";
import { PrioritySemaphore } from "../semaphore";

// The order frames get to load in.

it("lets the nearest waiters in first, as many as there are places, however they queued", async () => {
  vi.useFakeTimers();
  const places = new PrioritySemaphore(2);
  const order: string[] = [];
  const releases = new Map<string, () => void>();
  const distance: Record<string, number> = { far: 900, near: 10, middling: 300, nearest: 1 };

  for (const name of Object.keys(distance)) {
    void places.acquire(() => distance[name]!).then((release) => {
      order.push(name);
      releases.set(name, release);
    });
  }
  await vi.runAllTimersAsync();
  expect(order).toEqual(["nearest", "near"]);

  // A place comes free: the nearest of the rest, as things stand now.
  distance.far = 5;
  releases.get("nearest")!();
  await vi.runAllTimersAsync();
  expect(order).toEqual(["nearest", "near", "far"]);

  // Releasing twice frees one place, not two.
  releases.get("near")!();
  releases.get("near")!();
  await vi.runAllTimersAsync();
  expect(order).toEqual(["nearest", "near", "far", "middling"]);
  vi.useRealTimers();
});
