// Shared fixtures for the publish, remix and GC service tests: a harness per
// PublishStore implementation (in memory always; D1 over node:sqlite when the
// runtime has it), fake deps with a controllable clock, request builders and
// an upload simulator standing in for the client's PUTs.
import { getDb } from "../db";
import type { Bindings } from "../lib/env";
import { LARGE_FILE_BYTES } from "../lib/publish-limits";
import type { BeginPublishRequest, UploadInstruction } from "../lib/publish.schemas";
import { pointerKey, type UrlSigner } from "../lib/storage";
import type { GcDeps } from "../services/gc.service";
import type { PublishDeps } from "../services/publish.service";
import { d1PublishStore, type ObjectRef, type PublishStore } from "../services/publish.store";
import { createD1Shim, hasNodeSqlite, insertUser } from "./d1-sqlite";
import { memoryObjectStore, sha256Hex, type MemoryBucket } from "./memory-object-store";
import { memoryPublishStore } from "./memory-publish-store";

export type Harness = {
  store: PublishStore;
  addUser(id: string): void;
  versionNumbers(siteId: string): Promise<number[]>;
  setKeep(siteId: string, version: number): Promise<void>;
  // Every publish_session row of the account, and their plans' total length.
  sessionRows(userId: string): Promise<{ count: number; planBytes: number }>;
  // How many session object rows the session has.
  sessionObjectRows(sessionId: string): Promise<number>;
  // Deletes one session object row, as nothing but GC's retire does.
  dropSessionObject(sessionId: string, kind: "source" | "blob"): Promise<void>;
  // Marks a stored object as GC's claim does (deleting, unverified).
  markDeleting(userId: string, ref: ObjectRef): Promise<void>;
  // The site's retained version_site_file rows, as "<version>:<path>", sorted.
  siteFileRows(siteId: string): Promise<string[]>;
  // The bytes the publish tables and their indexes take in the database
  // (dbstat's page sizes), or null for the memory store.
  tableBytes(): number | null;
};

// Every table publish writes, as dbstat names their B-trees.
const PUBLISH_TABLES = [
  "site",
  "site_version",
  "version_site_file",
  "version_large_file",
  "stored_object",
  "publish_session",
  "publish_session_object",
  "publish_budget",
];

const memoryHarness = (): Harness => {
  const store = memoryPublishStore();
  return {
    store,
    addUser() {},
    async versionNumbers(siteId) {
      return store.state.versions
        .filter((v) => v.siteId === siteId)
        .map((v) => v.version)
        .sort((a, b) => a - b);
    },
    async setKeep(siteId, version) {
      const v = store.state.versions.find((x) => x.siteId === siteId && x.version === version);
      if (v) v.keep = true;
    },
    async sessionRows(userId) {
      const rows = [...store.state.sessions.values()].filter((s) => s.userId === userId);
      return { count: rows.length, planBytes: rows.reduce((sum, s) => sum + s.plan.length, 0) };
    },
    async sessionObjectRows(sessionId) {
      return store.state.sessionObjects.filter((o) => o.sessionId === sessionId).length;
    },
    async dropSessionObject(sessionId, kind) {
      const i = store.state.sessionObjects.findIndex(
        (o) => o.sessionId === sessionId && o.kind === kind,
      );
      if (i >= 0) store.state.sessionObjects.splice(i, 1);
    },
    async markDeleting(userId, ref) {
      const row = store.state.objects.get(`${userId}|${ref.kind}|${ref.sha256}`);
      if (row) {
        row.deleting = true;
        row.verified = false;
      }
    },
    async siteFileRows(siteId) {
      const versions = new Map(
        store.state.versions.filter((v) => v.siteId === siteId).map((v) => [v.id, v.version]),
      );
      return store.state.siteFiles
        .filter((f) => versions.has(f.versionId))
        .map((f) => `${versions.get(f.versionId)}:${f.path}`)
        .sort();
    },
    tableBytes: () => null,
  };
};

const d1Harness = (): Harness => {
  const shim = createD1Shim();
  const store = d1PublishStore(getDb({ DB: shim } as unknown as Bindings));
  return {
    store,
    addUser: (id) => insertUser(shim, id),
    async versionNumbers(siteId) {
      return (
        shim.sqlite
          .prepare("SELECT version FROM site_version WHERE site_id = ? ORDER BY version")
          .all(siteId) as { version: number }[]
      ).map((r) => r.version);
    },
    async setKeep(siteId, version) {
      shim.sqlite
        .prepare("UPDATE site_version SET keep = 1 WHERE site_id = ? AND version = ?")
        .run(siteId, version);
    },
    async sessionRows(userId) {
      const row = shim.sqlite
        .prepare(
          `SELECT count(*) AS n, coalesce(sum(length(plan)), 0) AS bytes
            FROM publish_session WHERE user_id = ?`,
        )
        .get(userId) as { n: number; bytes: number };
      return { count: Number(row.n), planBytes: Number(row.bytes) };
    },
    async sessionObjectRows(sessionId) {
      const row = shim.sqlite
        .prepare("SELECT count(*) AS n FROM publish_session_object WHERE session_id = ?")
        .get(sessionId) as { n: number };
      return Number(row.n);
    },
    async dropSessionObject(sessionId, kind) {
      shim.sqlite
        .prepare(
          `DELETE FROM publish_session_object WHERE rowid = (SELECT rowid
            FROM publish_session_object WHERE session_id = ? AND kind = ? LIMIT 1)`,
        )
        .run(sessionId, kind);
    },
    async markDeleting(userId, ref) {
      shim.sqlite
        .prepare(
          `UPDATE stored_object SET deleting = 1, verified = 0
            WHERE user_id = ? AND kind = ? AND sha256 = ?`,
        )
        .run(userId, ref.kind, ref.sha256);
    },
    async siteFileRows(siteId) {
      return (
        shim.sqlite
          .prepare(
            `SELECT v.version, f.path FROM version_site_file f
              JOIN site_version v ON v.id = f.version_id WHERE v.site_id = ?`,
          )
          .all(siteId) as { version: number; path: string }[]
      )
        .map((r) => `${r.version}:${r.path}`)
        .sort();
    },
    tableBytes() {
      const marks = PUBLISH_TABLES.map(() => "?").join(", ");
      const row = shim.sqlite
        .prepare(
          `SELECT COALESCE(SUM(pgsize), 0) AS bytes FROM dbstat WHERE name IN (
            SELECT name FROM sqlite_master WHERE tbl_name IN (${marks}))`,
        )
        .get(...PUBLISH_TABLES) as { bytes: number };
      return Number(row.bytes);
    },
  };
};

export const harnesses: [string, () => Harness][] = [
  ["memory store", memoryHarness],
  ...(hasNodeSqlite ? ([["d1 store (node:sqlite)", d1Harness]] as [string, () => Harness][]) : []),
];

export const T0 = Date.parse("2026-09-01T00:00:00Z");
export const MiB = 1024 * 1024;

// Sign "URLs" that name the bucket and key, so the simulator can land a PUT.
const fakeSigner: UrlSigner = {
  mode: "worker",
  async uploadUrl(t) {
    return {
      url: `https://upload.test/${t.bucket}/${t.key}`,
      headers: {
        "content-type": t.contentType,
        "content-length": String(t.size),
      },
    };
  },
  async downloadUrl(t) {
    return `https://download.test/${t.bucket}/${t.key}`;
  },
};

export type TestDeps = PublishDeps & {
  clock: { now: number };
  sitesBucket: MemoryBucket;
  sourcesBucket: MemoryBucket;
  limits: { publish: boolean; remix: boolean; complete: boolean };
  gc: GcDeps;
  harness: Harness;
};

export const makeTestDeps = (harness: Harness): TestDeps => {
  const clock = { now: T0 };
  const sites = memoryObjectStore({ pageSize: 3 });
  const sources = memoryObjectStore();
  const limits = { publish: true, remix: true, complete: true };
  let ids = 0;
  let suffix = 0;
  const deps: TestDeps = {
    store: harness.store,
    sites: sites.store,
    sources: sources.store,
    signer: fakeSigner,
    publishLimiter: { limit: async () => ({ success: limits.publish }) },
    remixLimiter: { limit: async () => ({ success: limits.remix }) },
    completeLimiter: { limit: async () => ({ success: limits.complete }) },
    siteUrl: (slug) => `https://${slug}.antidraw.test`,
    now: () => new Date(clock.now),
    newId: (prefix) => `${prefix}_${String(++ids).padStart(4, "0")}`,
    slugSuffix: () =>
      `s${String(++suffix).padStart(4, "0")}`.replace(/[01]/g, (d) => (d === "0" ? "a" : "b")),
    clock,
    sitesBucket: sites.bucket,
    sourcesBucket: sources.bucket,
    limits,
    gc: {
      store: harness.store,
      sites: sites.store,
      sources: sources.store,
      runId: () => `run${++ids}`,
    },
    harness,
  };
  return deps;
};

// A distinct, valid sha256 hex per label.
export const hex = (n: number | string) =>
  (typeof n === "number"
    ? n.toString(16)
    : [...n].map((c) => c.charCodeAt(0).toString(16)).join("")
  )
    .padStart(64, "0")
    .slice(-64);

export type Entries = Record<"preview.html" | "canvas.json" | "index.html", string>;
export const defaultEntries = (tag = "v1"): Entries => ({
  "preview.html": `<p>preview ${tag}</p>`,
  "canvas.json": JSON.stringify({ tag }),
  "index.html": `<p>index ${tag}</p>`,
});

export type PlanInput = {
  workspace?: string;
  name?: string;
  allowRemix?: boolean;
  source?: { sha256: string; size: number };
  largeFiles?: { path: string; sha256: string; size: number; mode?: 420 | 493 }[];
  files?: {
    path: string;
    sha256?: string;
    size?: number;
    contentType?: string;
    immutable?: boolean;
  }[];
  // The entry pages' contents, added to `files`; null leaves them out.
  entries?: Entries | null;
  fileCount?: number;
  uncompressedBytes?: number;
};

export const WORKSPACE = "11111111-1111-4111-8111-111111111111";
export const workspaceId = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;

const ENTRY_TYPES: Record<keyof Entries, string> = {
  "preview.html": "text/html; charset=utf-8",
  "canvas.json": "application/json; charset=utf-8",
  "index.html": "text/html; charset=utf-8",
};

export const entryFiles = async (entries: Entries = defaultEntries()) =>
  Promise.all(
    (Object.keys(entries) as (keyof Entries)[]).map(async (path) => ({
      path,
      sha256: await sha256Hex(entries[path]),
      size: new TextEncoder().encode(entries[path]).length,
      contentType: ENTRY_TYPES[path],
      immutable: false,
    })),
  );

export const beginRequest = async (input: PlanInput = {}): Promise<BeginPublishRequest> => {
  const entries = input.entries === null ? [] : await entryFiles(input.entries ?? defaultEntries());
  const largeFiles = (
    input.largeFiles ?? [{ path: "public/video.mp4", sha256: hex("blob-1"), size: 2 * MiB }]
  ).map((f) => ({ mode: 420 as const, ...f }));
  return {
    clientWorkspaceId: input.workspace ?? WORKSPACE,
    name: input.name ?? "Acme Canvas",
    ...(input.allowRemix !== undefined ? { allowRemix: input.allowRemix } : {}),
    snapshot: {
      source: input.source ?? { sha256: hex("source-1"), size: 1000 },
      largeFiles,
      fileCount: input.fileCount ?? 10 + largeFiles.length,
      uncompressedBytes:
        input.uncompressedBytes ?? 5000 + largeFiles.reduce((a, f) => a + f.size, 0),
    },
    site: {
      files: [
        ...(
          input.files ?? [
            { path: "assets/index-AbC12345.js", immutable: true, contentType: "text/javascript" },
            {
              path: "_antidraw/viewer-AbC12345.js",
              immutable: true,
              contentType: "text/javascript",
            },
            { path: "logo.png", contentType: "image/png" },
          ]
        ).map((f, i) => ({
          path: f.path,
          sha256: f.sha256 ?? hex(`site-${f.path}`),
          size: f.size ?? 100 + i,
          contentType: f.contentType ?? "application/octet-stream",
          immutable: f.immutable ?? false,
        })),
        ...entries,
      ],
    },
  };
};

type PointerJson = {
  v: 1;
  version: number;
  u: string;
  files: Record<string, { h: string; s: number; t: string; i?: 1 }>;
};

// The site's pointer as the publish Worker would read it, or null.
export const pointerOf = (deps: TestDeps, slug: string): PointerJson | null => {
  const text = deps.sitesBucket.text(pointerKey(slug));
  return text === null ? null : (JSON.parse(text) as PointerJson);
};

// What the client's PUTs leave in R2, for the given instructions.
export const performUploads = (deps: TestDeps, uploads: UploadInstruction[]) => {
  for (const u of uploads) {
    const [, bucket, ...rest] = new URL(u.url).pathname.split("/");
    const target = bucket === "sites" ? deps.sitesBucket : deps.sourcesBucket;
    target.upload(decodeURIComponent(rest.join("/")), {
      size: u.size,
      sha256: u.sha256,
      contentType: u.headers["content-type"],
    });
  }
};

// Records the key of every R2 HEAD the services make from here on.
export const recordHeads = (deps: TestDeps): string[] => {
  const keys: string[] = [];
  for (const store of [deps.sites, deps.sources]) {
    const head = store.head.bind(store);
    store.head = async (key) => {
      keys.push(key);
      return head(key);
    };
  }
  return keys;
};

export { LARGE_FILE_BYTES };
