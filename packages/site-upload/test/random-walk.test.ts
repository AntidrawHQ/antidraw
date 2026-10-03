import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SiteUploadError } from "../src/protocol/errors";
import type { Files, Manifest } from "../src/protocol/manifest";
import { contentType, isDocument } from "../src/server/content-type";
import { SiteServer, type Current } from "../src/server/serve";
import { SiteStore } from "../src/server/store";
import { bytes, manifestOf, sha256, startTestWorker, uniqueSite, type TestWorker } from "./helpers";

// A seeded random walk over the store's operations against real (local) R2,
// with the caller's record of what's live kept here as a server keeps it in
// its database: a commit goes live only if the record still shows the version
// its publish started from. Publishes interleave, old commits are replayed (a
// client retrying late), and cleanup runs between steps keeping the live and
// previous publishes. After every step the live version and the previous one's
// hashed chunks must all be stored; at the end of each walk every one of them
// must actually be served.

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

/** base: the record's seq when the publish started. */
type Publish = { id: string; manifest: Manifest; contents: Map<string, string>; base: number };
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
  const manifests = new Map<string, Manifest>();
  let publishes = 0;
  // The caller's record.
  const record: Current & { seq: number } = { live: null, previous: null, seq: 0 };

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
    const id = `s${seed}p${++publishes}`;
    const manifest = manifestOf(files, immutable);
    manifests.set(id, manifest);
    return { id, manifest, contents, base: record.seq };
  };

  /** The caller's commit: requireComplete, then switch the record if it's unchanged. */
  const commit = async (publish: Publish): Promise<string> => {
    await store.requireComplete(site, publish.id);
    if (record.live === publish.id) return "already live";
    if (record.seq !== publish.base) return "superseded";
    record.previous = record.live;
    record.live = publish.id;
    record.seq++;
    return "went live";
  };

  const code = (err: unknown) => (err instanceof SiteUploadError ? err.code : `THREW ${String(err)}`);

  /** Paths a viewer can reach: the live files, and the previous version's hashed chunks. */
  const servable = (): Files => {
    const live = record.live ? manifests.get(record.live)!.files : {};
    const out: Files = { ...live };
    for (const [path, entry] of Object.entries(record.previous ? manifests.get(record.previous)!.files : {})) {
      if (entry.i && !(path in live) && !isDocument(contentType(path))) out[path] = entry;
    }
    return out;
  };

  const checkLive = async (step: string) => {
    if (!record.live) return;
    const stored = new Map<string, number>();
    let cursor: string | undefined;
    do {
      const page = await worker.bucket.list({ prefix: `sites/${site}/f/`, cursor, limit: 1000 });
      for (const object of page.objects) stored.set(object.key.split("/").at(-1)!, object.size);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    for (const [path, entry] of Object.entries(servable())) {
      if (stored.get(entry.h) !== entry.s) violations.push(`${step}: ${path} is not stored`);
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
        try {
          const outcome = await commit(publish);
          count(`commit: ${outcome}`);
          open.splice(open.indexOf(publish), 1);
          if (outcome === "went live") committed.push(publish);
        } catch (err) {
          count(`commit: ${code(err)}`);
          if (code(err) !== "MISSING_FILES") violations.push(`${label}: commit of ${publish.id}: unexpected ${code(err)}`);
        }
      } else if (roll < 0.72 && committed.length) {
        // A late retry of an old commit must never change what's live.
        const publish = pick(committed);
        const before = record.live;
        try {
          count(`replay: ${await commit(publish)}`);
        } catch (err) {
          // Its plan was cleaned up: it was neither live nor previous any more.
          count(`replay: ${code(err)}`);
          if (code(err) !== "NO_PLAN") violations.push(`${label}: replaying ${publish.id}: unexpected ${code(err)}`);
        }
        if (record.live !== before) violations.push(`${label}: replaying ${publish.id} changed what's live`);
      } else if (roll < 0.82) {
        const keep = [record.live, record.previous].filter((id): id is string => id !== null);
        const result = await store.cleanup(site, { keep });
        count(result.deletedFiles ? "cleanup: deleted files" : "cleanup: nothing to delete");
        // Plans cleaned up can no longer be uploaded to or committed.
        for (const publish of [...open]) {
          if (!keep.includes(publish.id) && !(await store.readManifest(site, publish.id))) {
            open.splice(open.indexOf(publish), 1);
            count("cleanup: removed an open plan");
          }
        }
      } else if (roll < 0.85 && open.length) {
        open.splice(open.indexOf(pick(open)), 1);
        count("abandon");
      } else {
        clock += Math.floor(rand() * 45 + 1) * MINUTE;
        count("clock");
      }
    } catch (err) {
      violations.push(`${label}: unexpected ${code(err)}`);
    }
    await checkLive(label);
  }

  // Every servable path must actually be served, not just stored.
  const server = new SiteServer({ store, current: async () => record, now: () => clock });
  for (const path of Object.keys(servable())) {
    const res = await server.fetch(new Request(`https://walk.test/${path}`), site);
    await res.arrayBuffer();
    if (res.status !== 200) violations.push(`seed ${seed} end: GET /${path} → ${res.status}`);
    count("served at end");
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
        "abandon": 14,
        "cleanup: deleted files": 14,
        "cleanup: nothing to delete": 110,
        "cleanup: removed an open plan": 8,
        "clock": 113,
        "commit: MISSING_FILES": 41,
        "commit: superseded": 13,
        "commit: went live": 40,
        "plan": 88,
        "replay: NO_PLAN": 3,
        "replay: already live": 54,
        "replay: superseded": 37,
        "served at end": 65,
        "upload": 193,
      }
    `);
  });
});
