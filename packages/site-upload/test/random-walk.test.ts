import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SiteUploadError } from "../src/protocol/errors";
import type { Files, Manifest } from "../src/protocol/manifest";
import { contentType, isDocument } from "../src/server/content-type";
import { SiteServer } from "../src/server/serve";
import { SiteStore, type Pointer } from "../src/server/store";
import { bytes, manifestOf, sha256, startTestWorker, uniqueSite, type TestWorker } from "./helpers";

// A seeded random walk over the store's operations against real (local) R2.
// Requests run one at a time, as the caller's per-site lock guarantees, but two
// publishes may be interleaved and old commits are replayed, as happens when a
// lock expires or a client retries late. After every step the live site must
// be intact; at the end of each walk every live path must actually be served.

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
const STEPS = 60;
const MINUTE = 60 * 1000;

let worker: TestWorker;
beforeAll(async () => {
  worker = await startTestWorker();
});
afterAll(() => worker?.close());

/** mulberry32: small, fast, and the same sequence for the same seed everywhere. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Publish = { id: string; manifest: Manifest; contents: Map<string, string> };
type Stats = Record<string, number>;

async function walk(seed: number, stats: Stats): Promise<string[]> {
  const rand = random(seed);
  const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)]!;
  const chance = (p: number) => rand() < p;
  const count = (key: string) => (stats[key] = (stats[key] ?? 0) + 1);

  const site = uniqueSite(`walk${seed}`);
  let clock = Date.now();
  const store = new SiteStore({ bucket: worker.bucket, now: () => clock });
  const violations: string[] = [];
  const open: Publish[] = [];
  const committed: Publish[] = [];
  let publishes = 0;
  // A holder, so TypeScript doesn't narrow it to null across the async helper.
  const state: { live: Pointer | null } = { live: null };

  const newPublish = (): Publish => {
    const version = Math.floor(rand() * 6) + 1;
    const chunk = Math.floor(rand() * 4) + 1;
    const files: Record<string, string> = {
      "index.html": `<h1>page ${version}</h1>`,
      [`assets/app-${chunk}.js`]: `app ${chunk}`,
      [`assets/style-${Math.floor(rand() * 3) + 1}.css`]: `style ${chunk % 3}`,
    };
    if (chance(0.5)) files["about.html"] = `about ${Math.floor(rand() * 2)}`;
    if (chance(0.5)) files["media/video.mp4"] = "video bytes";
    if (chance(0.4)) files["icon.svg"] = `<svg>${Math.floor(rand() * 2)}</svg>`;
    // Mark hashed build output immutable, plus the SVG, which the server must still treat as a page.
    const immutable = Object.keys(files).filter((path) => path.startsWith("assets/") || path.endsWith(".svg"));
    const contents = new Map(Object.values(files).map((content) => [sha256(content), content]));
    return { id: `s${seed}p${++publishes}`, manifest: manifestOf(files, immutable), contents };
  };

  const code = (err: unknown) => (err instanceof SiteUploadError ? err.code : `THREW ${String(err)}`);

  const checkLive = async (step: string) => {
    const pointer = await store.readPointer(site);
    if (pointer && state.live && pointer.publishId !== state.live.publishId) {
      // The pointer changed; the new one must come from a plan made after the old one went live.
      const plan = committed.find((p) => p.id === pointer.publishId);
      if (!plan) violations.push(`${step}: pointer names ${pointer.publishId}, which never committed`);
    }
    state.live = pointer;
    if (!pointer) return;
    if (Object.keys(pointer.retained).length) count("steps with retained files live");
    const stored = new Map<string, number>();
    let cursor: string | undefined;
    do {
      const page = await worker.bucket.list({ prefix: `sites/${site}/f/`, cursor, limit: 1000 });
      for (const object of page.objects) stored.set(object.key.split("/").at(-1)!, object.size);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    for (const [label, files] of [["live", pointer.files], ["retained", pointer.retained]] as [string, Files][]) {
      for (const [path, entry] of Object.entries(files)) {
        if (stored.get(entry.h) !== entry.s) violations.push(`${step}: ${label} ${path} is not stored`);
      }
    }
    for (const [path, entry] of Object.entries(pointer.retained)) {
      if (!entry.i || isDocument(contentType(path))) violations.push(`${step}: retained ${path} is not a hashed asset`);
      if (path in pointer.files) violations.push(`${step}: retained ${path} is also live`);
    }
  };

  for (let step = 1; step <= STEPS; step++) {
    const label = `seed ${seed} step ${step}`;
    const roll = rand();
    try {
      if (roll < 0.18 && open.length < 2) {
        const publish = newPublish();
        await store.plan(site, publish.id, publish.manifest);
        open.push(publish);
        count("plan");
      } else if (roll < 0.43 && open.length) {
        const publish = pick(open);
        for (const [hash, content] of publish.contents) {
          if (!chance(0.85)) continue;
          const body = bytes(content);
          await store.putFile(site, publish.id, hash, body, body.length);
        }
        count("upload");
      } else if (roll < 0.66 && open.length) {
        const publish = pick(open);
        const before = state.live;
        try {
          const result = await store.commit(site, publish.id);
          count(result.alreadyCommitted ? "commit: already committed" : "commit: went live");
          if (before && result.previous !== before.publishId) {
            violations.push(`${label}: ${publish.id} went live on top of ${result.previous}, not ${before.publishId}`);
          }
          committed.push(publish);
          open.splice(open.indexOf(publish), 1);
        } catch (err) {
          count(`commit: ${code(err)}`);
          if (["SUPERSEDED", "PLAN_EXPIRED", "NO_PLAN"].includes(code(err))) open.splice(open.indexOf(publish), 1);
        }
      } else if (roll < 0.72 && committed.length) {
        // A late retry of an old commit must never change what's live.
        const publish = pick(committed);
        const before = await store.readPointer(site);
        try {
          await store.commit(site, publish.id);
          count("replay: accepted");
        } catch (err) {
          count(`replay: ${code(err)}`);
        }
        const after = await store.readPointer(site);
        if (before?.publishId !== after?.publishId && after?.publishId === publish.id) {
          violations.push(`${label}: replaying ${publish.id} rolled the site back`);
        }
      } else if (roll < 0.82) {
        const result = await store.cleanup(site);
        count(result.deletedFiles ? "cleanup: deleted files" : "cleanup: nothing to delete");
      } else if (roll < 0.85 && open.length) {
        open.splice(open.indexOf(pick(open)), 1);
        count("abandon");
      } else {
        clock += Math.floor(rand() * 45 + 1) * MINUTE;
        count("clock");
      }
    } catch (err) {
      const c = code(err);
      // Uploads to a plan that expired or was cleaned up are refused, which is correct.
      if (c === "PLAN_EXPIRED" || c === "NO_PLAN") {
        count(`refused: ${c}`);
        open.splice(0, open.length, ...open.filter((p) => !(err instanceof SiteUploadError) || !err.message.includes(p.id)));
      } else {
        violations.push(`${label}: unexpected ${c}`);
      }
    }
    await checkLive(label);
  }

  // Every live and retained path must actually be served, not just stored.
  if (state.live) {
    const server = new SiteServer({ store, now: () => clock });
    const pointer = state.live;
    for (const path of [...Object.keys(pointer.files), ...Object.keys(pointer.retained)]) {
      const res = await server.fetch(new Request(`https://walk.test/${path}`), site);
      await res.arrayBuffer();
      if (res.status !== 200) violations.push(`seed ${seed} end: GET /${path} → ${res.status}`);
      count("served at end");
    }
  }
  return violations;
}

describe("random walk", () => {
  it(`keeps every live site intact across ${SEEDS.length} seeded walks of ${STEPS} steps`, { timeout: 240_000 }, async () => {
    const stats: Stats = {};
    const violations: string[] = [];
    for (const seed of SEEDS) violations.push(...(await walk(seed, stats)));
    expect(violations).toEqual([]);
    // What the walks exercised, so a change that makes them trivial shows up here.
    expect(Object.fromEntries(Object.entries(stats).sort(([a], [b]) => a.localeCompare(b)))).toMatchInlineSnapshot(`
      {
        "abandon": 12,
        "cleanup: deleted files": 10,
        "cleanup: nothing to delete": 105,
        "clock": 105,
        "commit: MISSING_FILES": 34,
        "commit: NO_PLAN": 3,
        "commit: PLAN_EXPIRED": 6,
        "commit: SUPERSEDED": 9,
        "commit: went live": 36,
        "plan": 91,
        "refused: NO_PLAN": 2,
        "refused: PLAN_EXPIRED": 9,
        "replay: NO_PLAN": 25,
        "replay: PLAN_EXPIRED": 10,
        "replay: SUPERSEDED": 12,
        "replay: accepted": 75,
        "served at end": 70,
        "steps with retained files live": 287,
        "upload": 176,
      }
    `);
  });
});
