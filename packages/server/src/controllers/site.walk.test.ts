import { createHash } from "node:crypto";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "../test/harness";

// Model-based tests of the publishing API: fast-check runs random sequences
// of commands against the real Worker with local D1 and R2 (starts, plans,
// uploads, commits, the cron, time passing, a commit whose Worker stopped
// before recording it, and requests that race: a publish started during a
// plan, during a commit, or twice at once). A model predicts every answer the
// server gives from its own logic (the lock, what a replaced or expired
// publish is told, what a retry gets), and after every command the live site
// must be intact and D1 must agree with the model. A failure prints the
// shortest sequence fast-check could shrink it to, and a seed to replay it.
//
// Time passes by moving the run's D1 timestamps back, since the Worker's
// clock can't be set. R2 keeps real time, so the library's own plan TTL and
// grace period never run out here; @antidraw/site-upload's random walk covers
// those.

const MINUTE = 60 * 1000;
// From services/site.service.ts: the lock lasts an hour, and a publish's
// leftovers may be cleaned up 125 minutes after it started.
const LOCK_MS = 60 * MINUTE;
const CLEANUP_MS = 125 * MINUTE;

let server: TestServer;
let authorization: string;
beforeAll(async () => {
  server = await startServer();
  ({ authorization } = await server.signIn());
}, 60_000);
afterAll(() => server?.close());

const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

type Answer = { status: number; body: any };
type Entry = { h: string; s: number };

/** A publish's files, from small pools so publishes share some. */
type FilesSpec = { version: number; chunk: number; canvas: number; css: number | null };
const filesSpec: fc.Arbitrary<FilesSpec> = fc.record({
  version: fc.integer({ min: 1, max: 5 }),
  chunk: fc.integer({ min: 1, max: 3 }),
  canvas: fc.integer({ min: 0, max: 2 }),
  css: fc.option(fc.integer({ min: 0, max: 1 })),
});

type Publish = {
  id: string;
  /** A later publish took the lock while this one was open. */
  superseded: boolean;
  files: Record<string, Entry>;
  contents: Map<string, string>;
  planned: boolean;
  /** Hashes the plan said to upload and not yet uploaded. */
  missing: Set<string>;
};

/** Which publish a command acts on: the lock's holder, or any by index. */
type Target = "holder" | number;
const target: fc.Arbitrary<Target> = fc.oneof(
  { weight: 7, arbitrary: fc.constant("holder" as const) },
  { weight: 3, arbitrary: fc.nat({ max: 30 }) },
);

// What the commands exercised, over every run.
const stats: Record<string, number> = {};
const count = (key: string) => (stats[key] = (stats[key] ?? 0) + 1);

/** The model, and the site it drives. One per run. */
class Walk {
  // How far the run's clock is ahead of real time.
  shift = 0;
  publishes: Publish[] = [];
  holder: Publish | null = null;
  lockUntil = 0;
  cleanupAt: number | null = null;
  // What current.json names, and the publishes D1 records as live.
  live: Publish | null = null;
  recorded = new Set<string>();
  lastCommitted: Publish | null = null;

  constructor(readonly siteId: string) {}

  get base() {
    return `/api/sites/${this.siteId}/publishes`;
  }
  now() {
    return Date.now() + this.shift;
  }
  holds(p: Publish) {
    return this.holder === p && this.lockUntil > this.now();
  }
  resolve(t: Target): Publish {
    if (t === "holder" && this.holder) return this.holder;
    return this.publishes[(t === "holder" ? 0 : t) % this.publishes.length]!;
  }

  started(id: string, spec: FilesSpec) {
    const texts: Record<string, string> = {
      "preview.html": `<h1>v${spec.version}</h1>`,
      [`assets/app-${spec.chunk}.js`]: `app ${spec.chunk}`,
      "canvas.json": `{"v":${spec.canvas}}`,
      ...(spec.css !== null && { "assets/extra.css": `css ${spec.css}` }),
    };
    const files: Record<string, Entry> = {};
    const contents = new Map<string, string>();
    for (const [path, text] of Object.entries(texts)) {
      files[path] = { h: sha256(text), s: new TextEncoder().encode(text).length };
      contents.set(sha256(text), text);
    }
    // Every publish still open, not live, is replaced.
    for (const q of this.publishes) if (!this.recorded.has(q.id)) q.superseded = true;
    const publish: Publish = { id, superseded: false, files, contents, planned: false, missing: new Set() };
    this.publishes.push(publish);
    this.holder = publish;
    this.lockUntil = this.now() + LOCK_MS;
    this.cleanupAt = this.now() + CLEANUP_MS;
    return publish;
  }

  /** The server's answer to a request for `p` that doesn't hold a live lock. */
  refusal(p: Publish, path: string): string {
    if (this.recorded.has(p.id) || this.live === p) {
      // Went live: recorded now if it wasn't, releasing a lock it still has.
      this.recorded.add(p.id);
      if (this.holder === p) this.holder = null;
      return path === "commit" ? "200" : "409 CONFLICT";
    }
    if (this.holder === p) return "410 PLAN_EXPIRED";
    return p.superseded ? "409 SUPERSEDED" : "410 PLAN_EXPIRED";
  }

  committed(p: Publish) {
    // The server also records the publish this one replaced as live.
    if (this.live && this.live !== p) this.recorded.add(this.live.id);
    this.live = p;
    this.recorded.add(p.id);
    if (this.holder === p) this.holder = null;
    this.lastCommitted = p;
  }

  /** The live site is intact, and D1 agrees with the model. */
  async check() {
    const problems: string[] = [];
    const object = await server.env.SITES.get(`sites/${this.siteId}/current.json`);
    const pointer = object ? ((await object.json()) as { publishId: string; files: object; retained: object }) : null;
    const liveId = this.live?.id ?? null;
    if ((pointer?.publishId ?? null) !== liveId) problems.push(`current.json names ${pointer?.publishId}, want ${liveId}`);
    if (pointer) {
      const stored = new Map<string, number>();
      let cursor: string | undefined;
      do {
        const page = await server.env.SITES.list({ prefix: `sites/${this.siteId}/f/`, cursor });
        for (const o of page.objects) stored.set(o.key.split("/").at(-1)!, o.size);
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      for (const [label, files] of [["live", pointer.files], ["retained", pointer.retained]] as const) {
        for (const [path, entry] of Object.entries(files as Record<string, Entry>)) {
          if (stored.get(entry.h) !== entry.s) problems.push(`${label} ${path} is not stored`);
        }
      }
      if (this.live && !sameEntries(pointer.files as Record<string, Entry>, this.live.files)) {
        problems.push(`the live files aren't ${this.live.id}'s`);
      }
    }

    const row = (await server.env.DB.prepare(
      "SELECT lock_publish_id AS holder, busy_until AS busy, cleanup_after AS cleanupAfter FROM site WHERE id = ?",
    )
      .bind(this.siteId)
      .first<{ holder: string | null; busy: number | null; cleanupAfter: number | null }>())!;
    const holderId = this.holder?.id ?? null;
    if (row.holder !== holderId) problems.push(`lock held by ${row.holder}, want ${holderId}`);
    if (row.busy !== null) problems.push("the site is still busy");
    if ((row.cleanupAfter === null) !== (this.cleanupAt === null)) {
      problems.push(`cleanup_after is ${row.cleanupAfter}, want ${this.cleanupAt === null ? "none" : "set"}`);
    }
    const { results } = await server.env.DB.prepare("SELECT id FROM publish WHERE site_id = ? AND status = 'live'")
      .bind(this.siteId)
      .all<{ id: string }>();
    const liveRows = results.map((r) => r.id).sort().join(",");
    if (liveRows !== [...this.recorded].sort().join(",")) problems.push(`D1 records ${liveRows || "none"} live`);
    if (problems.length) throw new Error(problems.join("\n"));
  }
}

const sameEntries = (a: Record<string, Entry>, b: Record<string, Entry>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(b).every(([path, e]) => a[path]?.h === e.h && a[path]?.s === e.s);

const send = (method: string, path: string, init: { json?: unknown; body?: BodyInit; jsonType?: boolean } = {}) =>
  server.fetch(path, {
    method,
    headers: {
      authorization,
      ...((init.json !== undefined || init.jsonType) && { "content-type": "application/json" }),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    ...(init.body instanceof ReadableStream && { duplex: "half" }),
  } as RequestInit);
const answer = async (res: Response): Promise<Answer> => ({ status: res.status, body: await res.json() });
const codeOf = (a: Answer) => (a.status < 300 ? String(a.status) : `${a.status} ${a.body?.error?.code}`);
const expectCode = (what: string, got: Answer, want: string) => {
  if (codeOf(got) !== want) throw new Error(`${what}: got ${codeOf(got)} ${JSON.stringify(got.body)}, want ${want}`);
};

type Command = fc.AsyncCommand<Walk, Walk>;

/** Plans the holder (if it hasn't) and uploads everything its plan asked for. */
const prepare = async (w: Walk, p: Publish) => {
  if (!p.planned) {
    const planned = await answer(await send("POST", `${w.base}/${p.id}/plan`, { json: { v: 1, files: p.files } }));
    expectCode(`plan ${p.id}`, planned, "200");
    p.planned = true;
    p.missing = new Set(planned.body.missing);
  }
  for (const hash of [...p.missing]) {
    const got = await answer(await send("PUT", `${w.base}/${p.id}/files/${hash}`, { body: p.contents.get(hash)! }));
    expectCode(`upload to ${p.id}`, got, "200");
    p.missing.delete(hash);
  }
};
const hasPublishes = (w: Walk) => w.publishes.length > 0;

class Start implements Command {
  constructor(readonly spec: FilesSpec) {}
  check = () => true;
  async run(_: Walk, w: Walk) {
    const got = await answer(await send("POST", w.base));
    expectCode("start", got, "201");
    w.started(got.body.publishId, this.spec);
    count("start");
    await w.check();
  }
  toString = () => "start";
}

class Plan implements Command {
  constructor(readonly target: Target) {}
  check = hasPublishes;
  async run(_: Walk, w: Walk) {
    const p = w.resolve(this.target);
    const expected = w.holds(p) ? "200" : w.refusal(p, "plan");
    const got = await answer(await send("POST", `${w.base}/${p.id}/plan`, { json: { v: 1, files: p.files } }));
    expectCode(`plan ${p.id}`, got, expected);
    if (got.status === 200) {
      p.planned = true;
      p.missing = new Set(got.body.missing);
      if (w.live === p && p.missing.size) throw new Error("the live publish is missing files");
    }
    count(`plan: ${codeOf(got)}`);
    await w.check();
  }
  toString = () => `plan(${this.target})`;
}

/** One file a plan asked for (or all of them), from the holder or (stale) any publish. */
class Upload implements Command {
  constructor(readonly target: number, readonly file: number, readonly stale: boolean, readonly all: boolean) {}
  candidates = (w: Walk) => w.publishes.filter((p) => p.missing.size && (this.stale || w.holds(p)));
  check = (w: Readonly<Walk>) => this.candidates(w as Walk).length > 0;
  async run(_: Walk, w: Walk) {
    const candidates = this.candidates(w);
    const p = candidates[this.target % candidates.length]!;
    const hashes = [...p.missing];
    for (const hash of this.all ? hashes : [hashes[this.file % hashes.length]!]) {
      const expected = w.holds(p) ? "200" : w.refusal(p, "files");
      const got = await answer(await send("PUT", `${w.base}/${p.id}/files/${hash}`, { body: p.contents.get(hash)! }));
      expectCode(`upload to ${p.id}`, got, expected);
      if (got.status === 200) p.missing.delete(hash);
      count(`upload: ${codeOf(got)}`);
    }
    await w.check();
  }
  toString = () => `upload(${this.target}, ${this.all ? "all" : this.file}${this.stale ? ", stale" : ""})`;
}

class Commit implements Command {
  constructor(readonly target: Target) {}
  check = hasPublishes;
  async run(_: Walk, w: Walk) {
    const p = w.resolve(this.target);
    const previous = w.live?.id ?? null;
    let expected: string;
    if (!w.holds(p)) expected = w.refusal(p, "commit");
    else if (w.live === p) expected = "200";
    else if (!p.planned) expected = "404 NO_PLAN";
    else if (p.missing.size) expected = "409 MISSING_FILES";
    else expected = "200";
    const got = await answer(await send("POST", `${w.base}/${p.id}/commit`, { json: {} }));
    expectCode(`commit ${p.id}`, got, expected);
    if (got.status === 200 && !got.body.alreadyCommitted) {
      if (got.body.previous !== previous) throw new Error(`${p.id} went live on top of ${got.body.previous}, not ${previous}`);
      w.committed(p);
    } else if (got.status === 200 && w.live === p) {
      // Already live: recorded now if it wasn't, and the lock released.
      w.committed(p);
    } else if (got.status === 200 && !w.recorded.has(p.id)) {
      // A replayed commit answers from the record, and never changes the site.
      throw new Error(`${p.id}'s replayed commit answered 200 but it isn't live or recorded`);
    }
    count(`commit: ${codeOf(got)}${got.body?.alreadyCommitted ? " (already live)" : ""}`);
    await w.check();
  }
  toString = () => `commit(${this.target})`;
}

/** The whole publish, as the app's client does it: plan, upload what's missing, commit. */
class PublishAll implements Command {
  check = (w: Readonly<Walk>) => !!w.holder && (w as Walk).holds(w.holder) && w.live !== w.holder;
  async run(_: Walk, w: Walk) {
    const p = w.holder!;
    const previous = w.live?.id ?? null;
    await prepare(w, p);
    const got = await answer(await send("POST", `${w.base}/${p.id}/commit`, { json: {} }));
    expectCode(`commit ${p.id}`, got, "200");
    if (got.body.previous !== previous) throw new Error(`${p.id} went live on top of ${got.body.previous}, not ${previous}`);
    w.committed(p);
    count("publish in one go");
    await w.check();
  }
  toString = () => "publish in one go";
}

class PassTime implements Command {
  constructor(readonly minutes: number) {}
  check = () => true;
  async run(_: Walk, w: Walk) {
    const ms = this.minutes * MINUTE;
    await server.env.DB.batch([
      server.env.DB.prepare(
        "UPDATE site SET lock_until = lock_until - ?1, busy_until = busy_until - ?1, cleanup_after = cleanup_after - ?1 WHERE id = ?2",
      ).bind(ms, w.siteId),
      server.env.DB.prepare("UPDATE publish SET created_at = created_at - ? WHERE site_id = ?").bind(ms, w.siteId),
    ]);
    w.shift += ms;
    count("time passes");
    await w.check();
  }
  toString = () => `pass ${this.minutes} min`;
}

class Cron implements Command {
  check = () => true;
  async run(_: Walk, w: Walk) {
    const due = w.cleanupAt !== null && w.cleanupAt <= w.now();
    await server.scheduled();
    if (due) {
      w.holder = null;
      w.cleanupAt = null;
      if (w.live) w.recorded.add(w.live.id);
    }
    count(due ? "cron: cleaned up" : "cron: nothing due");
    await w.check();
  }
  toString = () => "cron";
}

/**
 * The Worker stopped after the last commit went live but before recording it;
 * the client retries while the lock lasts, or after it ran out.
 */
class LoseRecord implements Command {
  constructor(readonly expired: boolean) {}
  check = (w: Readonly<Walk>) => !!w.lastCommitted && w.live === w.lastCommitted && !w.holder;
  async run(_: Walk, w: Walk) {
    const p = w.lastCommitted!;
    const lockFor = this.expired ? -MINUTE : 30 * MINUTE;
    await server.env.DB.batch([
      server.env.DB.prepare("UPDATE publish SET status = 'open', committed_at = NULL WHERE id = ?").bind(p.id),
      server.env.DB.prepare("UPDATE site SET lock_publish_id = ?, lock_until = ? WHERE id = ?").bind(
        p.id,
        Date.now() + lockFor,
        w.siteId,
      ),
    ]);
    w.recorded.delete(p.id);
    w.holder = p;
    w.lockUntil = w.now() + lockFor;
    w.lastCommitted = null;
    count(`lose a record (lock ${this.expired ? "expired" : "live"})`);
    await w.check();
  }
  toString = () => `lose record (${this.expired ? "expired" : "live"} lock)`;
}

/** A publish started while the holder's plan is running, its body half sent. */
class StartDuringPlan implements Command {
  constructor(readonly spec: FilesSpec) {}
  check = (w: Readonly<Walk>) => !!w.holder && (w as Walk).holds(w.holder);
  async run(_: Walk, w: Walk) {
    const p = w.holder!;
    const manifest = new TextEncoder().encode(JSON.stringify({ v: 1, files: p.files }));
    let finish!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(manifest.slice(0, 8));
        finish = () => {
          controller.enqueue(manifest.slice(8));
          controller.close();
        };
      },
    });
    const planning = send("POST", `${w.base}/${p.id}/plan`, { body, jsonType: true });
    // Until the plan has reached the Worker and taken its hold.
    for (let tries = 0; tries < 200; tries++) {
      const row = await server.env.DB.prepare("SELECT busy_until AS busy FROM site WHERE id = ?")
        .bind(w.siteId)
        .first<{ busy: number | null }>();
      if (row?.busy) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const during = await answer(await send("POST", w.base));
    finish();
    const planned = await answer(await planning);
    if (during.status === 201) w.started(during.body.publishId, this.spec);
    expectCode("start during a plan", during, "409 SITE_BUSY");
    expectCode(`plan ${p.id} under a start`, planned, "200");
    p.planned = true;
    p.missing = new Set(planned.body.missing);
    count("start during a plan");
    await w.check();
  }
  toString = () => "start during a plan";
}

/** A commit and a new publish at once: either may go first, never both at once. */
class CommitAndStart implements Command {
  constructor(readonly spec: FilesSpec) {}
  check = (w: Readonly<Walk>) => !!w.holder && (w as Walk).holds(w.holder) && w.live !== w.holder;
  async run(_: Walk, w: Walk) {
    const p = w.holder!;
    const previous = w.live?.id ?? null;
    await prepare(w, p);
    const [c, s] = await Promise.all([
      send("POST", `${w.base}/${p.id}/commit`, { json: {} }).then(answer),
      send("POST", w.base).then(answer),
    ]);
    const outcome = `${codeOf(c)} / ${codeOf(s)}`;
    if (outcome === "200 / 409 SITE_BUSY" || outcome === "200 / 201") {
      if (c.body.previous !== previous) throw new Error(`went live on top of ${c.body.previous}, not ${previous}`);
      w.committed(p);
      if (s.status === 201) w.started(s.body.publishId, this.spec);
    } else if (outcome === "409 SUPERSEDED / 201") {
      w.started(s.body.publishId, this.spec);
    } else {
      throw new Error(`commit and start answered ${outcome}`);
    }
    count("commit and start at once");
    await w.check();
  }
  toString = () => "commit and start at once";
}

class TwoStarts implements Command {
  constructor(readonly a: FilesSpec, readonly b: FilesSpec) {}
  check = () => true;
  async run(_: Walk, w: Walk) {
    const [a, b] = await Promise.all([send("POST", w.base).then(answer), send("POST", w.base).then(answer)]);
    expectCode("first of two starts", a, "201");
    expectCode("second of two starts", b, "201");
    // The one whose lock stands went second, superseding the other.
    const row = await server.env.DB.prepare("SELECT lock_publish_id AS id FROM site WHERE id = ?")
      .bind(w.siteId)
      .first<{ id: string }>();
    const aWon = row?.id === a.body.publishId;
    w.started(aWon ? b.body.publishId : a.body.publishId, aWon ? this.b : this.a);
    w.started(aWon ? a.body.publishId : b.body.publishId, aWon ? this.a : this.b);
    count("two starts at once");
    await w.check();
  }
  toString = () => "two starts at once";
}

const commands = [
  { weight: 2, arbitrary: filesSpec.map((s) => new Start(s)) },
  { weight: 4, arbitrary: target.map((t) => new Plan(t)) },
  {
    weight: 5,
    arbitrary: fc
      .tuple(fc.nat({ max: 30 }), fc.nat({ max: 30 }), fc.nat({ max: 4 }).map((n) => n === 0), fc.boolean())
      .map(([t, f, stale, all]) => new Upload(t, f, stale, all)),
  },
  { weight: 4, arbitrary: target.map((t) => new Commit(t)) },
  { weight: 2, arbitrary: fc.constant(new PublishAll()) },
  { weight: 3, arbitrary: fc.constantFrom(7, 25, 45, 70, 140, 240).map((m) => new PassTime(m)) },
  { weight: 3, arbitrary: fc.constant(new Cron()) },
  { weight: 5, arbitrary: fc.boolean().map((e) => new LoseRecord(e)) },
  { weight: 1, arbitrary: filesSpec.map((s) => new StartDuringPlan(s)) },
  { weight: 2, arbitrary: filesSpec.map((s) => new CommitAndStart(s)) },
  { weight: 1, arbitrary: fc.tuple(filesSpec, filesSpec).map(([a, b]) => new TwoStarts(a, b)) },
].map(({ weight, arbitrary }) => ({ weight, arbitrary: arbitrary as fc.Arbitrary<Command> }));

describe("publishing, model-based", () => {
  it("keeps the lock, the records and the live site right under random sequences", { timeout: 300_000 }, async () => {
    let runs = 0;
    await fc.assert(
      fc.asyncProperty(fc.commands([fc.oneof(...commands)], { maxCommands: 60, size: "max" }), async (cmds) => {
        const res = await send("POST", "/api/sites", { json: { title: `walk ${++runs}` } });
        const walk = new Walk(((await res.json()) as { id: string }).id);
        await fc.asyncModelRun(() => ({ model: walk, real: walk }), cmds);
      }),
      { numRuns: 40 },
    );
    // Every kind of command ran, and the main outcomes happened, so a change
    // that makes the runs trivial fails here.
    for (const key of [
      "start",
      "plan: 200",
      "upload: 200",
      "publish in one go",
      "commit: 409 SUPERSEDED",
      "commit: 410 PLAN_EXPIRED",
      "cron: cleaned up",
      "start during a plan",
      "commit and start at once",
      "two starts at once",
      "lose a record (lock expired)",
      "lose a record (lock live)",
    ]) {
      expect.soft(stats[key] ?? 0, key).toBeGreaterThan(0);
    }
    console.log(Object.fromEntries(Object.entries(stats).sort(([a], [b]) => a.localeCompare(b))));
  });
});
