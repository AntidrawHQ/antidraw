// Shared fixtures for the publish, remix and GC service tests: a harness per
// PublishStore implementation (in memory always; D1 over node:sqlite when the
// runtime has it), fake deps with a controllable clock, request builders and
// an upload simulator standing in for the client's PUTs.
import { getDb } from "../db";
import type { Bindings } from "../lib/env";
import { IMMUTABLE_CACHE_CONTROL, LARGE_FILE_BYTES } from "../lib/publish-limits";
import type {
  BeginPublishRequest,
  CompletePublishRequest,
  UploadInstruction,
} from "../lib/publish.schemas";
import type { UrlSigner } from "../lib/storage";
import type { GcDeps } from "../services/gc.service";
import type { PublishDeps } from "../services/publish.service";
import { d1PublishStore, type PublishStore } from "../services/publish.store";
import { createD1Shim, hasNodeSqlite, insertUser } from "./d1-sqlite";
import { memoryObjectStore, sha256Hex, type MemoryBucket } from "./memory-object-store";
import { memoryPublishStore } from "./memory-publish-store";

export type Harness = {
  store: PublishStore;
  addUser(id: string): void;
  versionNumbers(siteId: string): Promise<number[]>;
  setKeep(siteId: string, version: number): Promise<void>;
  setProtected(siteId: string, value: string | null): Promise<void>;
};

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
    async setProtected(siteId, value) {
      const site = store.state.sites.get(siteId);
      if (site) site.protectedFiles = value;
    },
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
    async setProtected(siteId, value) {
      shim.sqlite.prepare("UPDATE site SET protected_files = ? WHERE id = ?").run(value, siteId);
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
        ...(t.cacheControl ? { "cache-control": t.cacheControl } : {}),
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
  limits: { publish: boolean; remix: boolean };
  gc: GcDeps;
  harness: Harness;
};

export const makeTestDeps = (harness: Harness): TestDeps => {
  const clock = { now: T0 };
  const sites = memoryObjectStore({ pageSize: 3 });
  const sources = memoryObjectStore();
  const limits = { publish: true, remix: true };
  let ids = 0;
  let suffix = 0;
  const deps: TestDeps = {
    store: harness.store,
    sites: sites.store,
    sources: sources.store,
    signer: fakeSigner,
    publishLimiter: { limit: async () => ({ success: limits.publish }) },
    remixLimiter: { limit: async () => ({ success: limits.remix }) },
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
  entries?: Entries;
  fileCount?: number;
  uncompressedBytes?: number;
};

export const WORKSPACE = "11111111-1111-4111-8111-111111111111";
export const workspaceId = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;

export const beginRequest = async (input: PlanInput = {}): Promise<BeginPublishRequest> => {
  const entries = input.entries ?? defaultEntries();
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
      files: (
        input.files ?? [
          { path: "assets/index-AbC12345.js", immutable: true, contentType: "text/javascript" },
          { path: "_antidraw/viewer.js", immutable: true, contentType: "text/javascript" },
          { path: "logo.png", contentType: "image/png" },
        ]
      ).map((f, i) => ({
        path: f.path,
        sha256: f.sha256 ?? hex(`site-${f.path}`),
        size: f.size ?? 100 + i,
        contentType: f.contentType ?? "application/octet-stream",
        immutable: f.immutable ?? false,
      })),
      entries: await Promise.all(
        (Object.keys(entries) as (keyof Entries)[]).map(async (path) => ({
          path,
          sha256: await sha256Hex(entries[path]),
          size: new TextEncoder().encode(entries[path]).length,
        })),
      ),
    },
  };
};

export const completeRequest = (entries: Entries = defaultEntries()): CompletePublishRequest => ({
  entries: (Object.keys(entries) as (keyof Entries)[]).map((path) => ({
    path,
    contentBase64: btoa(String.fromCharCode(...new TextEncoder().encode(entries[path]))),
  })),
});

// What the client's PUTs leave in R2, for the given instructions.
export const performUploads = (deps: TestDeps, uploads: UploadInstruction[]) => {
  for (const u of uploads) {
    const [, bucket, ...rest] = new URL(u.url).pathname.split("/");
    const target = bucket === "sites" ? deps.sitesBucket : deps.sourcesBucket;
    target.upload(decodeURIComponent(rest.join("/")), {
      size: u.size,
      sha256: u.sha256,
      contentType: u.headers["content-type"],
      cacheControl: u.headers["cache-control"],
    });
  }
};

export { IMMUTABLE_CACHE_CONTROL, LARGE_FILE_BYTES };
