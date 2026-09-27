import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { err, ok } from "neverthrow";
import type {
  ExclusionReport,
  PackedSnapshot,
  SnapshotError,
  SnapshotManifest,
  ScannedFile,
  SnapshotPlan,
  StagedSnapshot,
} from "@/main/lib/snapshot";
import {
  largestFiles,
  packSnapshot,
  scanWorkspace,
  stageSnapshot,
} from "@/main/lib/snapshot";
import {
  conversationEvents,
  getCliState,
  getPending,
} from "@/main/lib/conversation-store";
import { listConversations } from "@/main/api/services/chat.service";
import { getWorkspace } from "@/main/api/services/workspace.service";
import { getAccount } from "@/main/services/account.service";
import {
  buildWorkspaceSite,
  type BuiltSite,
  type SiteBuildError,
} from "../site-builder";
import {
  abortPublish,
  beginPublish,
  completePublish,
  fetchSiteStatus,
  getPublishSession,
  patchSite,
  type BeginPublishResponse,
  type CloudError,
} from "../cloud-publish";
import { uploadAll, type UploadTask } from "../uploader";
import { cloudTiming } from "../deadline";
import {
  cancelPublish,
  getPublishOutcome,
  getPublishStatus,
  mapCloudError,
  mapSiteBuildError,
  mapSnapshotError,
  publishTiming,
  publishWorkspace,
  setAllowRemix,
} from "../publish.service";
import type { PublishErrorCode, PublishEvent } from "../types";

const h = vi.hoisted(() => ({ root: "" }));

vi.mock("@/main/api/init", async () => {
  const path = await import("node:path");
  return {
    getAntidrawRoot: () => h.root,
    getWorkspaceSourcePath: (id: string) => path.join(h.root, "workspaces", id, "source"),
  };
});

vi.mock("@/main/api/services/workspace.service", () => ({ getWorkspace: vi.fn() }));
vi.mock("@/main/api/services/chat.service", () => ({ listConversations: vi.fn() }));
vi.mock("@/main/services/account.service", () => ({ getAccount: vi.fn() }));

// The real event emitter, so the activity watch is exercised for real; only
// the point-in-time reads are stubbed.
vi.mock("@/main/lib/conversation-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/main/lib/conversation-store")>();
  return { ...actual, getCliState: vi.fn(), getPending: vi.fn() };
});

vi.mock("@/main/lib/snapshot", () => ({
  LARGE_FILE_BYTES: 1024 * 1024,
  MAX_SNAPSHOT_BYTES: 500 * 1024 * 1024,
  MAX_UNCOMPRESSED_BYTES: 1000 * 1024 * 1024,
  MAX_SNAPSHOT_FILES: 100_000,
  scanWorkspace: vi.fn(),
  stageSnapshot: vi.fn(),
  packSnapshot: vi.fn(),
  largestFiles: vi.fn((list: { files: readonly { path: string; size: number }[] }, n = 10) =>
    [...list.files]
      .sort((a, b) => b.size - a.size)
      .slice(0, n)
      .map(({ path, size }) => ({ path, size })),
  ),
}));

vi.mock("../site-builder", () => ({ buildWorkspaceSite: vi.fn() }));
vi.mock("../cloud-publish", () => ({
  beginPublish: vi.fn(),
  completePublish: vi.fn(),
  getPublishSession: vi.fn(),
  abortPublish: vi.fn(),
  fetchSiteStatus: vi.fn(),
  patchSite: vi.fn(),
}));
vi.mock("../uploader", () => ({ uploadAll: vi.fn() }));

const WS = "8b0b7b5e-3f4c-4d57-9a55-2c1f2b0e8c11";
const MiB = 1024 * 1024;
const sha = (c: string) => c.repeat(64);

const site = {
  siteId: "site_abc",
  slug: "my-canvas-x7k2p",
  url: "https://my-canvas-x7k2p.antidraw.app",
  headVersion: 4,
  allowRemix: true,
  lastPublishedAt: "2026-09-27T10:00:00.000Z",
};

const excluded: ExclusionReport = {
  listed: [
    { path: ".env.local", isDir: false, reason: "always-excluded" },
    { path: "dist/", isDir: true, reason: "always-excluded" },
    { path: ".npmrc", isDir: false, reason: "secret" },
  ],
  grouped: [],
};

const manifest: SnapshotManifest = {
  version: 1,
  files: [
    { path: "src/App.tsx", size: 500, sha256: sha("c"), mode: 0o644, storage: "archive" },
    { path: "public/big.bin", size: 2 * MiB, sha256: sha("b"), mode: 0o644, storage: "blob" },
  ],
};

// What each stubbed stage produces; tests override pieces.
let packedOverrides: Partial<PackedSnapshot> = {};
let builtOverrides: Partial<BuiltSite> = {};
let stageHook: () => void = () => {};
let buildHook: () => void = () => {};

const siteFiles = [
  { path: "assets/index-AbC12345.js", size: 3, sha256: sha("d"), contentType: "text/javascript; charset=utf-8", immutable: true },
  { path: "logo.png", size: 4, sha256: sha("e"), contentType: "image/png", immutable: false },
];
const entries = [
  { path: "preview.html", size: 7, sha256: sha("1"), contentType: "text/html; charset=utf-8", immutable: false },
  { path: "canvas.json", size: 2, sha256: sha("2"), contentType: "application/json; charset=utf-8", immutable: false },
  { path: "index.html", size: 5, sha256: sha("3"), contentType: "text/html; charset=utf-8", immutable: false },
];

const beginResponse = (): BeginPublishResponse => ({
  publish: {
    id: "pub_1",
    siteId: site.siteId,
    slug: site.slug,
    url: site.url,
    baseVersion: 3,
    expiresAt: "2026-09-27T12:00:00.000Z",
  },
  uploads: [
    { kind: "source", sha256: sha("a"), size: 100, url: "https://r2.test/source", method: "PUT", headers: { "x-amz-checksum-sha256": "src" } },
    { kind: "blob", sha256: sha("b"), size: 2 * MiB, url: "https://r2.test/blob", method: "PUT", headers: { "x-amz-checksum-sha256": "blob" } },
    { kind: "site", sha256: sha("e"), size: 4, path: "logo.png", url: "https://r2.test/logo", method: "PUT", headers: { "content-type": "image/png" } },
  ],
});

const collect = async (gen: AsyncGenerator<PublishEvent>) => {
  const events: PublishEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
};

const run = (opts: { allowRemix?: boolean; signal?: AbortSignal } = {}) =>
  collect(
    publishWorkspace(WS, {
      ...(opts.allowRemix !== undefined ? { allowRemix: opts.allowRemix } : {}),
      signal: opts.signal ?? new AbortController().signal,
    }),
  );

const lastError = (events: PublishEvent[]) => {
  const last = events.at(-1);
  if (last?.type !== "error") throw new Error(`expected an error, got ${JSON.stringify(last)}`);
  return last.error;
};

const lastResult = (events: PublishEvent[]) => {
  const last = events.at(-1);
  if (last?.type !== "done") throw new Error(`expected done, got ${JSON.stringify(last)}`);
  return last.result;
};

const stagingDirs = async () =>
  (await fs.readdir(path.join(h.root, "tmp")).catch(() => [] as string[])).filter((n) =>
    n.startsWith("publish-"),
  );

const beginBody = () => vi.mocked(beginPublish).mock.calls[0]![0];

beforeAll(async () => {
  h.root = await fs.mkdtemp(path.join(os.tmpdir(), "antidraw-publish-"));
});

afterAll(async () => {
  await fs.rm(h.root, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  publishTiming.completeRetryBaseMs = 1;
  publishTiming.followDelaysMs = []; // main's background retries: off, but where tested
  packedOverrides = {};
  builtOverrides = {};
  stageHook = () => {};
  buildHook = () => {};

  vi.mocked(getAccount).mockResolvedValue(
    ok({ id: "u1", name: "Ada", email: "ada@example.com", image: null }),
  );
  vi.mocked(getWorkspace).mockResolvedValue(
    ok({ id: WS, name: "My canvas" } as never),
  );
  vi.mocked(listConversations).mockResolvedValue(
    ok([{ id: "conv-1", streamStatus: "idle" }] as never),
  );
  vi.mocked(getCliState).mockReturnValue("idle");
  vi.mocked(getPending).mockReturnValue([]);

  vi.mocked(scanWorkspace).mockImplementation(async (sourceDir) =>
    ok({ sourceDir, files: [], excluded } satisfies SnapshotPlan),
  );
  vi.mocked(stageSnapshot).mockImplementation(async (_plan, destDir) => {
    await fs.mkdir(destDir, { recursive: true });
    stageHook();
    return ok({ dir: destDir, manifest, excluded } satisfies StagedSnapshot);
  });
  vi.mocked(packSnapshot).mockImplementation(async (staged, out) => {
    await fs.writeFile(out.archiveFile, "archive");
    await fs.mkdir(out.blobDir, { recursive: true });
    const blobFile = path.join(out.blobDir, sha("b"));
    await fs.writeFile(blobFile, "blob");
    return ok({
      archiveFile: out.archiveFile,
      archiveSha256: sha("a"),
      archiveSize: 100,
      blobs: [{ sha256: sha("b"), size: 2 * MiB, file: blobFile, paths: ["public/big.bin"] }],
      snapshotBytes: 100 + 2 * MiB,
      uncompressedBytes: 500 + 2 * MiB,
      fileCount: 2,
      manifest: staged.manifest,
      ...packedOverrides,
    } satisfies PackedSnapshot);
  });
  vi.mocked(buildWorkspaceSite).mockImplementation(async (opts) => {
    opts.onLog?.("vite v7 building for production...", "stdout");
    buildHook();
    await fs.mkdir(path.join(opts.outDir, "assets"), { recursive: true });
    for (const f of [...siteFiles, ...entries]) {
      await fs.writeFile(path.join(opts.outDir, f.path), `<${f.path}>`);
    }
    return ok({
      dir: opts.outDir,
      files: siteFiles,
      entries,
      skipped: [".DS_Store"],
      componentCount: 2,
      totalBytes: 21,
      ...builtOverrides,
    } satisfies BuiltSite);
  });

  vi.mocked(beginPublish).mockResolvedValue(ok(beginResponse()));
  vi.mocked(uploadAll).mockImplementation(async (tasks, opts) => {
    const total = tasks.reduce((s, t) => s + t.size, 0);
    opts?.onProgress?.({ uploadedBytes: total, totalBytes: total, uploadedFiles: tasks.length, totalFiles: tasks.length });
    return ok(undefined);
  });
  vi.mocked(completePublish).mockResolvedValue(ok({ site, version: 4 }));
  vi.mocked(abortPublish).mockResolvedValue(ok(undefined));
});

describe("publishWorkspace: happy path", () => {
  test("emits the steps in order and ends with the result", async () => {
    const events = await run();

    expect(events.map((e) => (e.type === "step" ? e.step : e.type))).toEqual([
      "checking",
      "snapshot",
      "building",
      "build-log",
      "uploading",
      "upload-progress",
      "upload-progress",
      "finishing",
      "done",
    ]);
    expect(events).toContainEqual({ type: "build-log", line: "vite v7 building for production..." });

    const result = lastResult(events);
    expect(result).toMatchObject({
      url: site.url,
      slug: site.slug,
      version: 4,
      allowRemix: true,
      status: site,
      snapshot: { fileCount: 2, archiveBytes: 100, largeFileCount: 1, snapshotBytes: 100 + 2 * MiB },
      site: { fileCount: 5, uploadedFiles: 1, skipped: [".DS_Store"] },
      excluded,
    });
    // .env files are invisible to the build, and the result says so.
    expect(result.notes).toEqual([
      expect.objectContaining({ code: "ENV_FILES_EXCLUDED", paths: [".env.local"] }),
    ]);
    expect(abortPublish).not.toHaveBeenCalled();
  });

  test("the begin body describes the packed snapshot and the built site", async () => {
    await run();

    expect(beginBody()).toEqual({
      clientWorkspaceId: WS,
      name: "My canvas",
      snapshot: {
        source: { sha256: sha("a"), size: 100 },
        largeFiles: [{ path: "public/big.bin", sha256: sha("b"), size: 2 * MiB, mode: 0o644 }],
        fileCount: 2,
        uncompressedBytes: 500 + 2 * MiB,
      },
      // The entry pages are ordinary site files now.
      site: { files: [...siteFiles, ...entries] },
    });
  });

  test("a long name is cut to 100 UTF-16 units without splitting a surrogate pair", async () => {
    vi.mocked(getWorkspace).mockResolvedValue(
      ok({ id: WS, name: `  ${"a".repeat(99)}😀😀  ` } as never),
    );
    await run();
    // The server's zod max(100) counts UTF-16 units: 99 + a 2-unit emoji is 101.
    expect(beginBody().name).toBe("a".repeat(99));

    vi.mocked(beginPublish).mockClear();
    vi.mocked(getWorkspace).mockResolvedValue(ok({ id: WS, name: "😀".repeat(60) } as never));
    await run();
    expect(beginBody().name).toBe("😀".repeat(50));
  });

  test("allowRemix is omitted when not given, and sent when given", async () => {
    await run();
    expect(beginBody()).not.toHaveProperty("allowRemix");

    vi.mocked(beginPublish).mockClear();
    await run({ allowRemix: false });
    expect(beginBody()).toHaveProperty("allowRemix", false);

    vi.mocked(beginPublish).mockClear();
    await run({ allowRemix: true });
    expect(beginBody()).toHaveProperty("allowRemix", true);
  });

  test("upload instructions map to the right files", async () => {
    await run();

    const tasks = vi.mocked(uploadAll).mock.calls[0]![0] as UploadTask[];
    const rel = (file: string) => file.split(`${path.sep}publish-`)[1]!.split(path.sep).slice(1).join("/");
    expect(tasks.map((t) => [rel(t.file), t.url, t.size, t.headers])).toEqual([
      ["snapshot.tar.gz", "https://r2.test/source", 100, { "x-amz-checksum-sha256": "src" }],
      [`blobs/${sha("b")}`, "https://r2.test/blob", 2 * MiB, { "x-amz-checksum-sha256": "blob" }],
      ["site/logo.png", "https://r2.test/logo", 4, { "content-type": "image/png" }],
    ]);
  });

  test("entry pages are uploaded like any other site file", async () => {
    vi.mocked(beginPublish).mockResolvedValue(
      ok({
        ...beginResponse(),
        uploads: [
          { kind: "site", sha256: sha("3"), size: 5, path: "index.html", url: "https://r2.test/index", method: "PUT", headers: { "content-type": "text/html; charset=utf-8" } },
        ],
      }),
    );

    const result = lastResult(await run());

    const tasks = vi.mocked(uploadAll).mock.calls[0]![0] as UploadTask[];
    expect(tasks.map((t) => [path.basename(t.file), t.url, t.size, t.label])).toEqual([
      ["index.html", "https://r2.test/index", 5, "index.html"],
    ]);
    expect(result.site).toMatchObject({ fileCount: 5, uploadedFiles: 1 });
  });

  test("a site upload is matched by content: any path with that sha256 will do, once", async () => {
    // Two paths share one content; the server stores it once per account.
    builtOverrides = {
      files: [...siteFiles, { ...siteFiles[1]!, path: "copy/logo.png" }],
    };
    buildHook = () => {};
    vi.mocked(beginPublish).mockResolvedValue(
      ok({
        ...beginResponse(),
        uploads: [
          // No path at all, then the same content listed again under another.
          { kind: "site", sha256: sha("e"), size: 4, url: "https://r2.test/c-e", method: "PUT", headers: {} },
          { kind: "site", sha256: sha("e"), size: 4, path: "copy/logo.png", url: "https://r2.test/c-e2", method: "PUT", headers: {} },
        ],
      }),
    );

    const result = lastResult(await run());

    const tasks = vi.mocked(uploadAll).mock.calls[0]![0] as UploadTask[];
    expect(tasks.map((t) => [t.url, t.size, t.label])).toEqual([
      ["https://r2.test/c-e", 4, "logo.png"],
    ]);
    expect(result.site.uploadedFiles).toBe(1);
  });

  test("a site upload whose path names other content is matched by its sha256", async () => {
    vi.mocked(beginPublish).mockResolvedValue(
      ok({
        ...beginResponse(),
        uploads: [
          { kind: "site", sha256: sha("e"), size: 4, path: "index.html", url: "https://r2.test/c-e", method: "PUT", headers: {} },
        ],
      }),
    );

    await run();

    const tasks = vi.mocked(uploadAll).mock.calls[0]![0] as UploadTask[];
    expect(tasks.map((t) => t.label)).toEqual(["logo.png"]);
  });

  test("complete carries nothing but the session, and is timed by the plan's objects", async () => {
    await run();

    expect(completePublish).toHaveBeenCalledTimes(1);
    // Its time limit scales with the distinct objects complete may HEAD: the
    // source, the blobs and the site contents.
    const plan = vi.mocked(beginPublish).mock.calls[0]![0];
    const objects =
      1 +
      new Set(plan.snapshot.largeFiles.map((f) => f.sha256)).size +
      new Set(plan.site.files.map((f) => f.sha256)).size;
    expect(objects).toBeGreaterThan(1);
    expect(vi.mocked(completePublish).mock.calls[0]).toEqual(["pub_1", objects]);
  });

  test("an upload the plan does not contain is refused, and the session aborted", async () => {
    vi.mocked(beginPublish).mockResolvedValue(
      ok({
        ...beginResponse(),
        uploads: [{ kind: "site", sha256: sha("f"), size: 1, path: "../../etc/passwd", url: "https://r2.test/x", method: "PUT", headers: {} }],
      }),
    );

    const error = lastError(await run());

    expect(error.code).toBe("INTERNAL_ERROR");
    expect(uploadAll).not.toHaveBeenCalled();
    expect(abortPublish).toHaveBeenCalledWith("pub_1");
  });
});

describe("publishWorkspace: refusals before anything is uploaded", () => {
  test("signed out", async () => {
    vi.mocked(getAccount).mockResolvedValue(ok(null));
    expect(lastError(await run()).code).toBe("SIGNED_OUT");
    expect(scanWorkspace).not.toHaveBeenCalled();
  });

  test("server unreachable while checking the account", async () => {
    vi.mocked(getAccount).mockResolvedValue(
      err({ status: 502, code: "SERVER_UNREACHABLE", message: "Couldn't reach the AntiDraw server" }),
    );
    expect(lastError(await run()).code).toBe("SERVER_UNREACHABLE");
  });

  test("unknown workspace", async () => {
    vi.mocked(getWorkspace).mockResolvedValue(
      err({ status: 404 as const, code: "NOT_FOUND", message: "Workspace not found" }) as never,
    );
    expect(lastError(await run()).code).toBe("WORKSPACE_NOT_FOUND");
  });

  test("a second run for the same workspace gets PUBLISH_IN_PROGRESS", async () => {
    let release!: () => void;
    vi.mocked(buildWorkspaceSite).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return err({ code: "CANCELLED", message: "stopped" });
    });

    const first = publishWorkspace(WS, { signal: new AbortController().signal });
    const firstEvents: PublishEvent[] = [];
    // Pull until the first run is building, so it holds the lock.
    for (;;) {
      const { value } = await first.next();
      firstEvents.push(value as PublishEvent);
      if (value?.type === "step" && value.step === "building") break;
    }

    const second = await run();
    expect(lastError(second).code).toBe("PUBLISH_IN_PROGRESS");

    release();
    for await (const e of first) firstEvents.push(e);
    expect(lastError(firstEvents).code).toBe("CANCELLED");

    // The lock is gone with the run.
    expect(lastResult(await run()).version).toBe(4);
  });

  describe("WORKSPACE_BUSY", () => {
    test("a turn streaming at the start", async () => {
      vi.mocked(listConversations).mockResolvedValue(
        ok([{ id: "conv-1", streamStatus: "streaming" }] as never),
      );
      const error = lastError(await run());
      expect(error.code).toBe("WORKSPACE_BUSY");
      expect(error.message).toBe("Claude is still working. Publish when the turn finishes.");
      expect(scanWorkspace).not.toHaveBeenCalled();
      expect(beginPublish).not.toHaveBeenCalled();
    });

    test("a pending message while the CLI still reports idle", async () => {
      vi.mocked(getPending).mockImplementation((id) => (id === "conv-1" ? ["m1"] : []));
      expect(lastError(await run()).code).toBe("WORKSPACE_BUSY");
      expect(beginPublish).not.toHaveBeenCalled();
    });

    test("a CLI that is not idle", async () => {
      vi.mocked(getCliState).mockReturnValue("requires_action");
      expect(lastError(await run()).code).toBe("WORKSPACE_BUSY");
    });

    test("a turn that ran during stage, even though it is idle again", async () => {
      stageHook = () => {
        conversationEvents.emit("state", "conv-1", { state: "running" });
        conversationEvents.emit("state", "conv-1", { state: "idle" });
      };
      expect(lastError(await run()).code).toBe("WORKSPACE_BUSY");
      expect(packSnapshot).not.toHaveBeenCalled();
      expect(beginPublish).not.toHaveBeenCalled();
    });

    test("a message queued during stage", async () => {
      stageHook = () => {
        conversationEvents.emit("queue", "conv-1", { userMessageIds: ["m1"] });
        conversationEvents.emit("queue", "conv-1", { userMessageIds: [] });
      };
      expect(lastError(await run()).code).toBe("WORKSPACE_BUSY");
    });

    test("a turn during the build", async () => {
      buildHook = () => {
        conversationEvents.emit("state", "conv-1", { state: "spawning" });
        conversationEvents.emit("state", "conv-1", { state: "idle" });
      };
      expect(lastError(await run()).code).toBe("WORKSPACE_BUSY");
      expect(buildWorkspaceSite).toHaveBeenCalled();
      expect(beginPublish).not.toHaveBeenCalled();
    });

    test("a turn in a conversation created after the watch began", async () => {
      stageHook = () => {
        vi.mocked(listConversations).mockResolvedValue(
          ok([
            { id: "conv-1", streamStatus: "idle" },
            { id: "conv-new", streamStatus: "idle" },
          ] as never),
        );
        conversationEvents.emit("state", "conv-new", { state: "running" });
        conversationEvents.emit("state", "conv-new", { state: "idle" });
      };
      expect(lastError(await run()).code).toBe("WORKSPACE_BUSY");
      expect(beginPublish).not.toHaveBeenCalled();
    });

    test("a turn in another workspace does not block", async () => {
      stageHook = () => {
        conversationEvents.emit("state", "conv-elsewhere", { state: "running" });
      };
      expect(lastResult(await run()).version).toBe(4);
    });

    test("the watch stops listening when the run ends", async () => {
      const state = conversationEvents.listenerCount("state");
      const queue = conversationEvents.listenerCount("queue");
      await run();
      expect(conversationEvents.listenerCount("state")).toBe(state);
      expect(conversationEvents.listenerCount("queue")).toBe(queue);
    });
  });

  describe("local limit pre-checks", () => {
    test("snapshot over 500 MiB → PUBLISH_TOO_LARGE with largestFiles", async () => {
      packedOverrides = { snapshotBytes: 501 * MiB };
      const error = lastError(await run());
      expect(error.code).toBe("PUBLISH_TOO_LARGE");
      expect(error.details?.largestFiles).toEqual([
        { path: "public/big.bin", size: 2 * MiB },
        { path: "src/App.tsx", size: 500 },
      ]);
      expect(error.details?.snapshotBytes).toBe(501 * MiB);
      expect(largestFiles).toHaveBeenCalled();
      expect(beginPublish).not.toHaveBeenCalled();
      expect(buildWorkspaceSite).not.toHaveBeenCalled();
    });

    test("uncompressed bytes over 1000 MiB → PUBLISH_TOO_LARGE", async () => {
      packedOverrides = { uncompressedBytes: 1000 * MiB + 1 };
      const error = lastError(await run());
      expect(error.code).toBe("PUBLISH_TOO_LARGE");
      expect(error.details?.uncompressedBytes).toBe(1000 * MiB + 1);
      expect(beginPublish).not.toHaveBeenCalled();
    });

    test("more than 100 000 files → PUBLISH_TOO_LARGE", async () => {
      packedOverrides = { fileCount: 100_001 };
      const error = lastError(await run());
      expect(error.code).toBe("PUBLISH_TOO_LARGE");
      expect(error.details?.fileCount).toBe(100_001);
      expect(beginPublish).not.toHaveBeenCalled();
    });

    test("more than 1 000 large-file paths → PUBLISH_TOO_LARGE", async () => {
      packedOverrides = {
        manifest: {
          version: 1,
          files: Array.from({ length: 1001 }, (_, i) => ({
            path: `big/${i}.bin`,
            size: MiB,
            sha256: sha("b"),
            mode: 0o644 as const,
            storage: "blob" as const,
          })),
        },
      };
      const error = lastError(await run());
      expect(error.code).toBe("PUBLISH_TOO_LARGE");
      expect(error.details?.largeFileCount).toBe(1001);
      expect(beginPublish).not.toHaveBeenCalled();
    });

    describe("from the scan plan, before anything is staged", () => {
      const scanned = (p: string, size: number): ScannedFile => ({
        path: p,
        absPath: `/ws/${p}`,
        size,
        mode: 0o644,
        viaSymlink: false,
        dev: 1,
        ino: 1,
      });
      const planOf = (files: ScannedFile[]) =>
        vi.mocked(scanWorkspace).mockImplementation(async (sourceDir) =>
          ok({ sourceDir, files, excluded } satisfies SnapshotPlan),
        );
      const expectNothingStaged = async () => {
        expect(stageSnapshot).not.toHaveBeenCalled();
        expect(packSnapshot).not.toHaveBeenCalled();
        expect(buildWorkspaceSite).not.toHaveBeenCalled();
        expect(beginPublish).not.toHaveBeenCalled();
        expect(await stagingDirs()).toEqual([]);
      };

      test("uncompressed bytes over 1000 MiB, with the plan's largest files", async () => {
        planOf([
          scanned("src/App.tsx", 500),
          scanned("assets/a.mp4", 600 * MiB),
          scanned("assets/b.mp4", 400 * MiB + 1),
        ]);
        const error = lastError(await run());
        expect(error.code).toBe("PUBLISH_TOO_LARGE");
        expect(error.details).toMatchObject({
          uncompressedBytes: 1000 * MiB + 501,
          fileCount: 3,
          largeFileCount: 2,
          largestFiles: [
            { path: "assets/a.mp4", size: 600 * MiB },
            { path: "assets/b.mp4", size: 400 * MiB + 1 },
            { path: "src/App.tsx", size: 500 },
          ],
        });
        expect(error.details?.snapshotBytes).toBeUndefined();
        await expectNothingStaged();
      });

      test("more than 100 000 files", async () => {
        planOf(Array.from({ length: 100_001 }, (_, i) => scanned(`gen/${i}.txt`, 1)));
        const error = lastError(await run());
        expect(error.code).toBe("PUBLISH_TOO_LARGE");
        expect(error.details?.fileCount).toBe(100_001);
        expect(error.details?.largestFiles).toHaveLength(10);
        await expectNothingStaged();
      });

      test("more than 1 000 files at or over the large-file size", async () => {
        planOf(Array.from({ length: 1001 }, (_, i) => scanned(`big/${i}.bin`, MiB)));
        const error = lastError(await run());
        expect(error.code).toBe("PUBLISH_TOO_LARGE");
        expect(error.details?.largeFileCount).toBe(1001);
        await expectNothingStaged();
      });

      test("a plan exactly at the limits is staged", async () => {
        // 1000 large files adding up to exactly 1000 MiB.
        planOf(Array.from({ length: 1000 }, (_, i) => scanned(`big/${i}.bin`, MiB)));
        lastResult(await run());
        expect(stageSnapshot).toHaveBeenCalled();
      });
    });

    // The three entry pages are ordinary site files now, so they count.
    const assets = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        path: `assets/f${i}-AbC12345.js`,
        size: 1,
        sha256: sha("d"),
        contentType: "text/javascript",
        immutable: true,
      }));

    test("more than 5 000 site files, entry pages included → SITE_TOO_LARGE", async () => {
      builtOverrides = { files: assets(4998) };
      const error = lastError(await run());
      expect(error.code).toBe("SITE_TOO_LARGE");
      expect(error.details?.siteFileCount).toBe(5001);
      expect(beginPublish).not.toHaveBeenCalled();
    });

    test("exactly 5 000 site files, entry pages included, is allowed", async () => {
      builtOverrides = { files: assets(4997) };
      vi.mocked(beginPublish).mockResolvedValue(ok({ ...beginResponse(), uploads: [] }));
      lastResult(await run());
      expect(vi.mocked(beginPublish).mock.calls[0]![0].site.files).toHaveLength(5000);
    });

    test("site bytes over 500 MiB → SITE_TOO_LARGE", async () => {
      builtOverrides = {
        files: [{ ...siteFiles[0]!, size: 500 * MiB }],
      };
      const error = lastError(await run());
      expect(error.code).toBe("SITE_TOO_LARGE");
      expect(error.details?.siteBytes).toBe(500 * MiB + 14);
    });
  });
});

describe("publishWorkspace: server and upload failures", () => {
  test("QUOTA_EXCEEDED from begin gets largestFiles added", async () => {
    vi.mocked(beginPublish).mockResolvedValue(
      err({
        status: 413,
        code: "QUOTA_EXCEEDED",
        message: "Quota exceeded",
        details: { quotaBytes: 1024 * MiB, usedBytes: 1000 * MiB, publishBytes: 40 * MiB },
      }),
    );

    const error = lastError(await run());

    expect(error).toMatchObject({
      code: "QUOTA_EXCEEDED",
      details: {
        quotaBytes: 1024 * MiB,
        usedBytes: 1000 * MiB,
        publishBytes: 40 * MiB,
        largestFiles: [
          { path: "public/big.bin", size: 2 * MiB },
          { path: "src/App.tsx", size: 500 },
        ],
      },
    });
    // No session was created, so there is nothing to abort.
    expect(abortPublish).not.toHaveBeenCalled();
  });

  test("an upload failure aborts the session, and says nothing about the live site", async () => {
    vi.mocked(uploadAll).mockResolvedValue(
      err({ code: "UPLOAD_FAILED", message: "Upload of logo.png failed (403)", label: "logo.png", status: 403 }),
    );

    const error = lastError(await run());

    expect(error).toEqual({
      code: "UPLOAD_FAILED",
      message: "Upload of logo.png failed (403)",
    });
    expect(abortPublish).toHaveBeenCalledWith("pub_1");
    expect(completePublish).not.toHaveBeenCalled();
  });

  test("a conflict at complete never aborts", async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 409, code: "PUBLISH_CONFLICT", message: "Head moved" }),
    );

    const error = lastError(await run());

    expect(error.code).toBe("PUBLISH_CONFLICT");
    expect(error.details).toBeUndefined();
    expect(completePublish).toHaveBeenCalledTimes(1);
    expect(abortPublish).not.toHaveBeenCalled();
  });

  test("with nothing to upload, a failure at complete is mapped as is", async () => {
    vi.mocked(beginPublish).mockResolvedValue(ok({ ...beginResponse(), uploads: [] }));
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 410, code: "PUBLISH_EXPIRED", message: "Expired" }),
    );

    const error = lastError(await run());

    expect(error.code).toBe("PUBLISH_EXPIRED");
    expect(error.details).toBeUndefined();
  });
});

describe("publishWorkspace: complete", () => {
  test("is retried on 503 and 409 PUBLISH_IN_PROGRESS, then succeeds", async () => {
    vi.mocked(completePublish)
      .mockResolvedValueOnce(err({ status: 503, code: "SERVER_ERROR", message: "Unavailable" }))
      .mockResolvedValueOnce(err({ status: 409, code: "PUBLISH_IN_PROGRESS", message: "Locked" }))
      .mockResolvedValueOnce(err({ status: 502, code: "SERVER_UNREACHABLE", message: "Offline" }))
      .mockResolvedValueOnce(ok({ site, version: 4 }));

    const events = await run();

    expect(lastResult(events).version).toBe(4);
    expect(completePublish).toHaveBeenCalledTimes(4);
    expect(new Set(vi.mocked(completePublish).mock.calls.map(([id]) => id))).toEqual(new Set(["pub_1"]));
    expect(abortPublish).not.toHaveBeenCalled();
  });

  test("is retried on 429 RATE_LIMITED, then succeeds", async () => {
    vi.mocked(completePublish)
      .mockResolvedValueOnce(err({ status: 429, code: "RATE_LIMITED", message: "Slow down" }))
      .mockResolvedValueOnce(ok({ site, version: 4 }));

    expect(lastResult(await run()).version).toBe(4);
    expect(completePublish).toHaveBeenCalledTimes(2);
  });

  test("rate limited on every attempt → RATE_LIMITED, not an unknown outcome", async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 429, code: "RATE_LIMITED", message: "Slow down" }),
    );

    const error = lastError(await run());

    expect(error.code).toBe("RATE_LIMITED");
    expect(completePublish).toHaveBeenCalledTimes(5);
    expect(getPublishSession).not.toHaveBeenCalled();
    expect(abortPublish).not.toHaveBeenCalled();
  });

  test("rate limited after an ambiguous failure still asks what became of the session", async () => {
    const limited = err({ status: 429, code: "RATE_LIMITED", message: "Slow down" } as const);
    vi.mocked(completePublish)
      .mockResolvedValueOnce(err({ status: 502, code: "SERVER_UNREACHABLE", message: "Offline" }))
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(limited)
      .mockResolvedValueOnce(limited)
      .mockResolvedValue(ok({ site: { ...site, headVersion: 5 }, version: 5 }));
    vi.mocked(getPublishSession).mockResolvedValue(
      ok({ status: "completed", resultVersion: 5, live: false, site: { ...site, headVersion: 5 } }),
    );

    expect(lastResult(await run()).version).toBe(5);
    expect(getPublishSession).toHaveBeenCalledWith("pub_1");
  });

  test("cancel during finishing is ignored, and abort is never sent", async () => {
    const caller = new AbortController();
    let cancelled: boolean | undefined;
    vi.mocked(completePublish).mockImplementationOnce(async () => {
      cancelled = cancelPublish(WS);
      caller.abort();
      return err({ status: 503, code: "SERVER_ERROR", message: "Unavailable" });
    });

    const events = await run({ signal: caller.signal });

    expect(cancelled).toBe(false);
    expect(lastResult(events).version).toBe(4);
    expect(completePublish).toHaveBeenCalledTimes(2);
    expect(abortPublish).not.toHaveBeenCalled();
  });

  test("no answer after 5 attempts, session completed → complete confirms it live → done", async () => {
    const offline = err({ status: 502, code: "SERVER_UNREACHABLE", message: "Offline" } as const);
    vi.mocked(completePublish)
      .mockResolvedValueOnce(offline)
      .mockResolvedValueOnce(offline)
      .mockResolvedValueOnce(offline)
      .mockResolvedValueOnce(offline)
      .mockResolvedValueOnce(offline)
      .mockResolvedValue(ok({ site: { ...site, headVersion: 7 }, version: 7 }));
    vi.mocked(getPublishSession).mockResolvedValue(
      ok({ status: "completed", resultVersion: 7, live: false, site: { ...site, headVersion: 7 } }),
    );

    const events = await run();

    expect(completePublish).toHaveBeenCalledTimes(6);
    expect(getPublishSession).toHaveBeenCalledWith("pub_1");
    expect(lastResult(events)).toMatchObject({ version: 7, url: site.url });
  });

  // The server commits, then switches the site over; complete answers only
  // once visitors see the version. A committed session whose switch-over
  // keeps failing is not live, whatever the session read says.
  test("session completed but the site never switched over → PUBLISH_OUTCOME_UNKNOWN, not published", async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 500, code: "STORAGE_FAILED", message: "saved, but not switched over" }),
    );
    vi.mocked(getPublishSession).mockResolvedValue(
      ok({ status: "completed", resultVersion: 4, live: false, site: { ...site, headVersion: 4 } }),
    );

    const events = await run();
    const error = lastError(events);

    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(error.code).toBe("PUBLISH_OUTCOME_UNKNOWN");
    expect(error.message).toBe(
      "The publish was saved, but the site hasn't switched over to it yet. Check again in a moment.",
    );
    expect(error.details?.publishId).toBe("pub_1");
    // Five attempts, then one more once the session read says it committed.
    expect(completePublish).toHaveBeenCalledTimes(6);
    expect(abortPublish).not.toHaveBeenCalled();
  });

  test("no answer after 5 attempts, session completed and live → done, with no confirming complete", async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 502, code: "SERVER_UNREACHABLE", message: "Offline" }),
    );
    vi.mocked(getPublishSession).mockResolvedValue(
      ok({ status: "completed", resultVersion: 7, live: true, site: { ...site, headVersion: 7 } }),
    );

    const events = await run();

    expect(completePublish).toHaveBeenCalledTimes(5);
    expect(lastResult(events)).toMatchObject({ version: 7, url: site.url });
  });

  test("session completed, and complete then refuses for good → that refusal, not published", async () => {
    vi.mocked(completePublish)
      .mockResolvedValueOnce(err({ status: 500, code: "STORAGE_FAILED", message: "x" }))
      .mockResolvedValueOnce(err({ status: 500, code: "STORAGE_FAILED", message: "x" }))
      .mockResolvedValueOnce(err({ status: 500, code: "STORAGE_FAILED", message: "x" }))
      .mockResolvedValueOnce(err({ status: 500, code: "STORAGE_FAILED", message: "x" }))
      .mockResolvedValueOnce(err({ status: 500, code: "STORAGE_FAILED", message: "x" }))
      .mockResolvedValue(err({ status: 404, code: "SITE_NOT_FOUND", message: "Gone" }));
    vi.mocked(getPublishSession).mockResolvedValue(
      ok({ status: "completed", resultVersion: 4, live: false, site: { ...site, headVersion: 4 } }),
    );

    const error = lastError(await run());

    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.details?.serverCode).toBe("SITE_NOT_FOUND");
  });

  test("no answer after 5 attempts, session pending → PUBLISH_OUTCOME_UNKNOWN", async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 409, code: "PUBLISH_IN_PROGRESS", message: "Locked" }),
    );
    vi.mocked(getPublishSession).mockResolvedValue(
      ok({ status: "pending", resultVersion: null, live: false, site }),
    );

    const error = lastError(await run());

    expect(error.code).toBe("PUBLISH_OUTCOME_UNKNOWN");
    expect(error.message).toBe("The publish may still finish. Check again in a moment.");
    expect(error.details?.publishId).toBe("pub_1");
    expect(abortPublish).not.toHaveBeenCalled();
  });

  test("no answer, and the session could not be read → PUBLISH_OUTCOME_UNKNOWN", async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 500, code: "PUBLISH_STORE_FAILED", message: "D1" }),
    );
    vi.mocked(getPublishSession).mockResolvedValue(
      err({ status: 502, code: "SERVER_UNREACHABLE", message: "Offline" }),
    );

    expect(lastError(await run()).code).toBe("PUBLISH_OUTCOME_UNKNOWN");
  });

  test("no answer, session expired → PUBLISH_EXPIRED", async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 503, code: "SERVER_ERROR", message: "Unavailable" }),
    );
    vi.mocked(getPublishSession).mockResolvedValue(
      ok({ status: "expired", resultVersion: null, live: false, site }),
    );

    expect(lastError(await run()).code).toBe("PUBLISH_EXPIRED");
  });
});

describe("publishWorkspace: cancel and time limits around server calls", () => {
  const timing = { ...cloudTiming };
  afterEach(() => Object.assign(cloudTiming, timing));

  const cancelOn = async (step: string) => {
    const events: PublishEvent[] = [];
    for await (const event of publishWorkspace(WS, { signal: new AbortController().signal })) {
      events.push(event);
      if (event.type === "step" && event.step === step) expect(cancelPublish(WS)).toBe(true);
    }
    return events;
  };

  test("a cancel while the account is being checked ends the run at once", async () => {
    vi.mocked(getAccount).mockImplementationOnce(() => new Promise(() => {}));

    const error = lastError(await cancelOn("checking"));

    expect(error.code).toBe("CANCELLED");
    expect(scanWorkspace).not.toHaveBeenCalled();
  });

  test("an account check that never answers ends as SERVER_UNREACHABLE", async () => {
    cloudTiming.requestTimeoutMs = 20;
    vi.mocked(getAccount).mockImplementationOnce(() => new Promise(() => {}));

    expect(lastError(await run()).code).toBe("SERVER_UNREACHABLE");
    expect(scanWorkspace).not.toHaveBeenCalled();
  });

  test("begin gets the run's signal: a cancel while it is in flight ends the run at once", async () => {
    vi.mocked(beginPublish).mockImplementationOnce(
      (_body, opts) =>
        new Promise((resolve) => {
          opts?.signal?.addEventListener("abort", () =>
            resolve(err({ status: 499, code: "CANCELLED", message: "The request was cancelled" })),
          );
          expect(cancelPublish(WS)).toBe(true);
        }),
    );

    const events = await run();

    expect(lastError(events)).toEqual({ code: "CANCELLED", message: "Publishing was cancelled." });
    // "uploading" comes only once begin has answered with a session.
    expect(events).not.toContainEqual({ type: "step", step: "uploading" });
    expect(uploadAll).not.toHaveBeenCalled();
    // No session came back, so there is nothing to abort.
    expect(abortPublish).not.toHaveBeenCalled();
  });

  test("a cancel that lands just as begin answers still aborts the new session", async () => {
    vi.mocked(beginPublish).mockImplementationOnce(async () => {
      cancelPublish(WS);
      return ok(beginResponse());
    });

    expect(lastError(await run()).code).toBe("CANCELLED");
    expect(abortPublish).toHaveBeenCalledWith("pub_1");
  });
});

describe("main finishes a publish left unfinished in the background", () => {
  const pending = { status: "pending" as const, resultVersion: null, live: false, site };
  const later = new Date(Date.now() + 60 * 60_000).toISOString();
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(check()).toBe(true);
  };
  const leaveUnfinished = async () => {
    vi.mocked(beginPublish).mockResolvedValue(
      ok({ ...beginResponse(), publish: { ...beginResponse().publish, expiresAt: later } }),
    );
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 502, code: "SERVER_UNREACHABLE", message: "Offline" }),
    );
    vi.mocked(getPublishSession).mockResolvedValue(ok(pending));
    expect(lastError(await run()).code).toBe("PUBLISH_OUTCOME_UNKNOWN");
    vi.mocked(completePublish).mockClear();
  };
  afterEach(() => {
    publishTiming.followDelaysMs = [];
  });

  test("keeps sending complete, with nothing asking, until the publish is live", async () => {
    publishTiming.followDelaysMs = [5];
    await leaveUnfinished();
    await waitFor(() => vi.mocked(completePublish).mock.calls.length >= 2);
    expect(vi.mocked(completePublish).mock.calls[0]).toEqual(["pub_1", 7]);

    vi.mocked(completePublish).mockResolvedValue(ok({ site: { ...site, headVersion: 4 }, version: 4 }));
    const before = vi.mocked(completePublish).mock.calls.length;
    await waitFor(() => vi.mocked(completePublish).mock.calls.length > before);
    // Live: the record is dropped, and nothing more is sent.
    const settled = vi.mocked(completePublish).mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(vi.mocked(completePublish).mock.calls.length).toBe(settled);
    vi.mocked(getPublishSession).mockResolvedValue(
      ok({ status: "completed", resultVersion: 4, live: false, site }),
    );
    await getPublishOutcome(WS, "pub_1");
    expect(vi.mocked(completePublish).mock.calls.length).toBe(settled);
  });

  test("stops once the workspace publishes again", async () => {
    publishTiming.followDelaysMs = [20];
    await leaveUnfinished();
    vi.mocked(completePublish).mockResolvedValue(ok({ site, version: 4 }));
    await run(); // takes the workspace over: one complete, its own
    expect(completePublish).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 60));
    expect(completePublish).toHaveBeenCalledTimes(1);
  });

  // A run that ends before begin replaces nothing: the earlier session is
  // still the one to finish, by a check and by main on its own.
  const live = () =>
    vi.mocked(completePublish).mockResolvedValue(ok({ site: { ...site, headVersion: 4 }, version: 4 }));

  test("a publish that fails before begin keeps the earlier session, and a check still finishes it", async () => {
    await leaveUnfinished();
    vi.mocked(beginPublish).mockClear();
    vi.mocked(getAccount).mockResolvedValue(
      err({ status: 502, code: "SERVER_UNREACHABLE", message: "Couldn't reach the AntiDraw server" }),
    );
    expect(lastError(await run()).code).toBe("SERVER_UNREACHABLE");
    expect(beginPublish).not.toHaveBeenCalled();

    live();
    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrap()).toMatchObject({
      status: "completed",
      resultVersion: 4,
    });
    expect(completePublish).toHaveBeenCalledWith("pub_1", 7);
  });

  test("a publish refused before begin (no entry pages) keeps it too, and never says uploading", async () => {
    await leaveUnfinished();
    vi.mocked(beginPublish).mockClear();
    builtOverrides = { entries: [] };
    const events = await run();
    expect(lastError(events).code).toBe("BUILD_FAILED");
    expect(events).not.toContainEqual({ type: "step", step: "uploading" });
    expect(beginPublish).not.toHaveBeenCalled();

    live();
    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrap().status).toBe("completed");
    expect(completePublish).toHaveBeenCalledTimes(1);
  });

  // Begin answered without a session: nothing replaced the earlier one, so it
  // is still finished, and the renderer is never told it was let go.
  test.each([
    ["a server error", err({ status: 503, code: "INTERNAL_ERROR", message: "Down" } as const), "SERVER_ERROR"],
    ["the rate limit", err({ status: 429, code: "RATE_LIMITED", message: "Slow down" } as const), "RATE_LIMITED"],
    [
      "the open-sessions cap",
      err({ status: 429, code: "RATE_LIMITED", message: "Too many", details: { reason: "open-sessions" } } as const),
      "RATE_LIMITED",
    ],
    ["the quota", err({ status: 413, code: "QUOTA_EXCEEDED", message: "Full" } as const), "QUOTA_EXCEEDED"],
    ["a lost answer", err({ status: 502, code: "SERVER_UNREACHABLE", message: "Timed out" } as const), "SERVER_UNREACHABLE"],
  ])("a begin refused by %s keeps the earlier session, and a check still finishes it", async (_, refusal, code) => {
    await leaveUnfinished();
    vi.mocked(beginPublish).mockClear().mockResolvedValueOnce(refusal);
    const events = await run();
    expect(lastError(events).code).toBe(code);
    expect(beginPublish).toHaveBeenCalledTimes(1);
    expect(events).not.toContainEqual({ type: "step", step: "uploading" });

    live();
    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrap()).toMatchObject({
      status: "completed",
      resultVersion: 4,
    });
    expect(completePublish).toHaveBeenCalledWith("pub_1", 7);
  });

  test("main keeps following it through a begin that failed, and finishes it after", async () => {
    publishTiming.followDelaysMs = [5];
    await leaveUnfinished();
    vi.mocked(beginPublish).mockResolvedValueOnce(
      err({ status: 503, code: "INTERNAL_ERROR", message: "Down" }),
    );
    expect(lastError(await run()).code).toBe("SERVER_ERROR");

    live();
    await waitFor(() =>
      vi.mocked(completePublish).mock.calls.some(([id]) => id === "pub_1"),
    );
  });

  test("a publish cancelled while begin is in flight keeps it too", async () => {
    await leaveUnfinished();
    vi.mocked(beginPublish).mockImplementationOnce(
      (_body, opts) =>
        new Promise((resolve) => {
          opts?.signal?.addEventListener("abort", () =>
            resolve(err({ status: 499, code: "CANCELLED", message: "The request was cancelled" })),
          );
          cancelPublish(WS);
        }),
    );
    expect(lastError(await run()).code).toBe("CANCELLED");

    live();
    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrap().status).toBe("completed");
    expect(completePublish).toHaveBeenCalledWith("pub_1", 7);
  });

  test("a cancel that lands just as begin answers keeps it, and aborts only the new session", async () => {
    await leaveUnfinished();
    vi.mocked(beginPublish).mockImplementationOnce(async () => {
      cancelPublish(WS);
      return ok({ ...beginResponse(), publish: { ...beginResponse().publish, id: "pub_2" } });
    });
    expect(lastError(await run()).code).toBe("CANCELLED");
    expect(abortPublish).toHaveBeenCalledWith("pub_2");
    expect(abortPublish).not.toHaveBeenCalledWith("pub_1");

    live();
    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrap().status).toBe("completed");
    expect(completePublish).toHaveBeenCalledWith("pub_1", 7);
  });

  test("main keeps following it through a cancelled publish, and finishes it after", async () => {
    publishTiming.followDelaysMs = [5];
    await leaveUnfinished();
    vi.mocked(getAccount).mockImplementationOnce(() => new Promise(() => {}));
    const events: PublishEvent[] = [];
    for await (const event of publishWorkspace(WS, { signal: new AbortController().signal })) {
      events.push(event);
      if (event.type === "step" && event.step === "checking") cancelPublish(WS);
    }
    expect(lastError(events).code).toBe("CANCELLED");

    live();
    await waitFor(() =>
      vi.mocked(completePublish).mock.calls.some(([id]) => id === "pub_1"),
    );
    // Live: the record is dropped.
    const settled = vi.mocked(completePublish).mock.calls.length;
    await new Promise((r) => setTimeout(r, 40));
    expect(vi.mocked(completePublish).mock.calls.length).toBe(settled);
  });

  test("while a publish holds the workspace, a check only reads, and a committed session reads pending", async () => {
    await leaveUnfinished();
    let release!: () => void;
    vi.mocked(buildWorkspaceSite).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return err({ code: "CANCELLED", message: "stopped" });
    });
    const holding = publishWorkspace(WS, { signal: new AbortController().signal });
    for (;;) {
      const event = (await holding.next()).value as PublishEvent;
      if (event.type === "step" && event.step === "building") break;
    }

    const committed = { status: "completed" as const, resultVersion: 4, live: false, site };
    vi.mocked(getPublishSession).mockResolvedValue(ok(committed));
    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrap()).toEqual({
      ...committed,
      status: "pending",
    });
    expect(completePublish).not.toHaveBeenCalled();

    release();
    await collect(holding);
    live();
    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrap().status).toBe("completed");
    expect(completePublish).toHaveBeenCalledTimes(1);
  });
});

describe("getPublishOutcome: finishing a publish left pending", () => {
  const pending = { status: "pending" as const, resultVersion: null, live: false, site };

  // A run whose every complete got no definite answer, and whose session was
  // still pending afterwards.
  const leavePending = async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 502, code: "SERVER_UNREACHABLE", message: "Offline" }),
    );
    vi.mocked(getPublishSession).mockResolvedValueOnce(ok(pending));
    const error = lastError(await run());
    expect(error.code).toBe("PUBLISH_OUTCOME_UNKNOWN");
    vi.mocked(completePublish).mockReset();
    vi.mocked(getPublishSession).mockReset();
    return error.details!.publishId!;
  };

  test("sends complete again for the same session, and reports the publish live", async () => {
    const publishId = await leavePending();
    vi.mocked(getPublishSession).mockResolvedValue(ok(pending));
    vi.mocked(completePublish).mockResolvedValue(ok({ site: { ...site, headVersion: 4 }, version: 4 }));

    const outcome = await getPublishOutcome(WS, publishId);

    expect(outcome._unsafeUnwrap()).toEqual({
      status: "completed",
      resultVersion: 4,
      live: true,
      site: { ...site, headVersion: 4 },
    });
    // Timed by the run's plan, as the run's own completes were.
    expect(vi.mocked(completePublish).mock.calls).toEqual([["pub_1", 7]]);

    // Done: later checks only read.
    vi.mocked(getPublishSession).mockResolvedValue(
      ok({ status: "completed", resultVersion: 4, live: false, site }),
    );
    await getPublishOutcome(WS, publishId);
    expect(completePublish).toHaveBeenCalledTimes(1);
  });

  test("a session committed but not yet live reads pending until complete confirms it", async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 500, code: "STORAGE_FAILED", message: "saved, but not switched over" }),
    );
    const committed = { status: "completed" as const, resultVersion: 4, live: false, site: { ...site, headVersion: 4 } };
    vi.mocked(getPublishSession).mockResolvedValue(ok(committed));
    const error = lastError(await run());
    expect(error.code).toBe("PUBLISH_OUTCOME_UNKNOWN");
    vi.mocked(completePublish).mockClear();

    // The switch-over still fails: not live, so pending, and nothing aborted.
    expect((await getPublishOutcome(WS, error.details!.publishId!))._unsafeUnwrap()).toEqual({
      ...committed,
      status: "pending",
    });
    expect(completePublish).toHaveBeenCalledWith("pub_1", 7);
    expect(abortPublish).not.toHaveBeenCalled();

    // It goes through: live.
    vi.mocked(completePublish).mockResolvedValue(ok({ site: { ...site, headVersion: 4 }, version: 4 }));
    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrap()).toEqual({ ...committed, live: true });
    expect(completePublish).toHaveBeenCalledTimes(2);

    // Done: later checks only read.
    await getPublishOutcome(WS, "pub_1");
    expect(completePublish).toHaveBeenCalledTimes(2);
  });

  test("a committed session complete refuses for good is let go with that refusal, not aborted", async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 500, code: "STORAGE_FAILED", message: "saved, but not switched over" }),
    );
    const committed = { status: "completed" as const, resultVersion: 4, live: false, site };
    vi.mocked(getPublishSession).mockResolvedValue(ok(committed));
    expect(lastError(await run()).code).toBe("PUBLISH_OUTCOME_UNKNOWN");
    vi.mocked(completePublish)
      .mockClear()
      .mockResolvedValue(err({ status: 404, code: "SITE_NOT_FOUND", message: "Gone" }));

    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrapErr().code).toBe("INTERNAL_ERROR");
    expect(abortPublish).not.toHaveBeenCalled();

    // Let go: the next check only reads, and a committed session the site
    // never switched over to still reads pending.
    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrap().status).toBe("pending");
    expect(completePublish).toHaveBeenCalledTimes(1);
  });

  test("a committed session the read reports live is done without another complete", async () => {
    const publishId = await leavePending();
    const live = { status: "completed" as const, resultVersion: 4, live: true, site: { ...site, headVersion: 4 } };
    vi.mocked(getPublishSession).mockResolvedValue(ok(live));

    expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap()).toEqual(live);
    expect(completePublish).not.toHaveBeenCalled();

    // Let go: a later read that says otherwise sends nothing either.
    vi.mocked(getPublishSession).mockResolvedValue(ok(pending));
    await getPublishOutcome(WS, publishId);
    expect(completePublish).not.toHaveBeenCalled();
  });

  test("a session this process does not hold reads pending while committed but not live", async () => {
    const committed = { status: "completed" as const, resultVersion: 4, live: false, site };
    vi.mocked(getPublishSession).mockResolvedValue(ok(committed));
    expect((await getPublishOutcome(WS, "pub_other"))._unsafeUnwrap()).toEqual({
      ...committed,
      status: "pending",
    });
    vi.mocked(getPublishSession).mockResolvedValue(ok({ ...committed, live: true }));
    expect((await getPublishOutcome(WS, "pub_other"))._unsafeUnwrap().status).toBe("completed");
    expect(completePublish).not.toHaveBeenCalled();
  });

  // The server answers 404 for a session GC deleted (one that never committed
  // a day after it expired, a committed one after a week) and for another
  // account's: only what this process saw of it says whether it went live.
  describe("a session the server no longer knows", () => {
    const notFound = err({ status: 404, code: "PUBLISH_NOT_FOUND", message: "Publish session not found" } as const);
    const leaveWith = async (expiresAt: string, read: typeof pending | ReturnType<typeof committedRead>) => {
      vi.mocked(beginPublish).mockResolvedValue(
        ok({ ...beginResponse(), publish: { ...beginResponse().publish, expiresAt } }),
      );
      vi.mocked(completePublish).mockResolvedValue(
        err({ status: 502, code: "SERVER_UNREACHABLE", message: "Offline" }),
      );
      vi.mocked(getPublishSession).mockResolvedValueOnce(ok(read));
      const error = lastError(await run());
      expect(error.code).toBe("PUBLISH_OUTCOME_UNKNOWN");
      vi.mocked(completePublish).mockReset();
      vi.mocked(getPublishSession).mockReset();
      return error.details!.publishId!;
    };
    const committedRead = () => ({ status: "completed" as const, resultVersion: 4, live: false, site });
    const past = () => new Date(Date.now() - 60_000).toISOString();
    const future = () => new Date(Date.now() + 60 * 60_000).toISOString();

    test("never seen committed, and past its expiry: it ended, it did not go live", async () => {
      const publishId = await leaveWith(past(), pending);
      vi.mocked(getPublishSession).mockResolvedValue(notFound);
      vi.mocked(fetchSiteStatus).mockResolvedValue(ok({ ...site, headVersion: 3 }));

      expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap()).toEqual({
        status: "expired",
        resultVersion: null,
        live: false,
        site: { ...site, headVersion: 3 },
      });
      expect(completePublish).not.toHaveBeenCalled();

      // Let go: nothing is sent for it again.
      vi.mocked(getPublishSession).mockResolvedValue(ok(pending));
      await getPublishOutcome(WS, publishId);
      expect(completePublish).not.toHaveBeenCalled();
    });

    test("seen committed: done, with the site as it is now", async () => {
      const publishId = await leaveWith(past(), committedRead());
      vi.mocked(getPublishSession).mockResolvedValue(notFound);
      vi.mocked(fetchSiteStatus).mockResolvedValue(ok({ ...site, headVersion: 9 }));

      expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap()).toEqual({
        status: "completed",
        resultVersion: null,
        live: true,
        site: { ...site, headVersion: 9 },
      });
      expect(completePublish).not.toHaveBeenCalled();
    });

    test("seen committed by a later check's read, then gone: done", async () => {
      const publishId = await leaveWith(past(), pending);
      vi.mocked(getPublishSession).mockResolvedValueOnce(ok(committedRead()));
      vi.mocked(completePublish).mockResolvedValue(
        err({ status: 500, code: "STORAGE_FAILED", message: "saved, but not switched over" }),
      );
      expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap().status).toBe("pending");

      vi.mocked(getPublishSession).mockResolvedValue(notFound);
      vi.mocked(fetchSiteStatus).mockResolvedValue(ok({ ...site, headVersion: 9 }));
      expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap().status).toBe("completed");
    });

    test("before its expiry (another account's answer): the server's error, and it is still finished later", async () => {
      const publishId = await leaveWith(future(), pending);
      vi.mocked(getPublishSession).mockResolvedValue(notFound);
      vi.mocked(fetchSiteStatus).mockResolvedValue(ok({ ...site, headVersion: 3 }));

      expect((await getPublishOutcome(WS, publishId))._unsafeUnwrapErr().details?.serverCode).toBe(
        "PUBLISH_NOT_FOUND",
      );
      expect(completePublish).not.toHaveBeenCalled();

      // Kept: once the session reads again, it is finished.
      vi.mocked(getPublishSession).mockResolvedValue(ok(pending));
      vi.mocked(completePublish).mockResolvedValue(ok({ site: { ...site, headVersion: 4 }, version: 4 }));
      expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap().status).toBe("completed");
      expect(completePublish).toHaveBeenCalledWith("pub_1", 7);
    });

    test("a session this process did not begin: the server's error", async () => {
      vi.mocked(getPublishSession).mockResolvedValue(notFound);
      vi.mocked(fetchSiteStatus).mockResolvedValue(ok({ ...site, headVersion: 9 }));
      expect((await getPublishOutcome(WS, "pub_unknown"))._unsafeUnwrapErr().details?.serverCode).toBe(
        "PUBLISH_NOT_FOUND",
      );
    });

    test("without a site (unpublished since): the server's error", async () => {
      const publishId = await leaveWith(past(), committedRead());
      vi.mocked(getPublishSession).mockResolvedValue(notFound);
      vi.mocked(fetchSiteStatus).mockResolvedValue(ok(null));
      expect((await getPublishOutcome(WS, publishId))._unsafeUnwrapErr().details?.serverCode).toBe(
        "PUBLISH_NOT_FOUND",
      );
    });
  });

  test("still no answer → pending, and the next check tries again", async () => {
    const publishId = await leavePending();
    vi.mocked(getPublishSession).mockResolvedValue(ok(pending));
    vi.mocked(completePublish)
      .mockResolvedValueOnce(err({ status: 409, code: "PUBLISH_IN_PROGRESS", message: "Locked" }))
      .mockResolvedValueOnce(ok({ site, version: 4 }));

    expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap().status).toBe("pending");
    expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap().status).toBe("completed");
    expect(completePublish).toHaveBeenCalledTimes(2);
  });

  test("the run's own session read failing still leaves it resumable", async () => {
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 500, code: "PUBLISH_STORE_FAILED", message: "D1" }),
    );
    vi.mocked(getPublishSession).mockResolvedValueOnce(
      err({ status: 502, code: "SERVER_UNREACHABLE", message: "Offline" }),
    );
    expect(lastError(await run()).code).toBe("PUBLISH_OUTCOME_UNKNOWN");
    vi.mocked(completePublish).mockReset().mockResolvedValue(ok({ site, version: 4 }));
    vi.mocked(getPublishSession).mockReset().mockResolvedValue(ok(pending));

    expect((await getPublishOutcome(WS, "pub_1"))._unsafeUnwrap().status).toBe("completed");
  });

  test("a definite refusal aborts the session, so the answer is that it ended", async () => {
    const publishId = await leavePending();
    vi.mocked(getPublishSession)
      .mockResolvedValueOnce(ok(pending))
      .mockResolvedValueOnce(ok({ ...pending, status: "aborted" }));
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 409, code: "UPLOAD_INCOMPLETE", message: "Missing" }),
    );

    const outcome = await getPublishOutcome(WS, publishId);

    expect(outcome._unsafeUnwrap().status).toBe("aborted");
    expect(abortPublish).toHaveBeenCalledWith("pub_1");
  });

  test("an abort that fails is tried again on the next check, without another complete", async () => {
    const publishId = await leavePending();
    vi.mocked(getPublishSession).mockResolvedValue(ok(pending));
    vi.mocked(completePublish).mockResolvedValue(
      err({ status: 409, code: "UPLOAD_INCOMPLETE", message: "Missing" }),
    );
    vi.mocked(abortPublish).mockResolvedValueOnce(
      err({ status: 502, code: "SERVER_UNREACHABLE", message: "Offline" }),
    );

    expect((await getPublishOutcome(WS, publishId))._unsafeUnwrapErr().code).toBe("UPLOAD_FAILED");

    vi.mocked(getPublishSession)
      .mockResolvedValueOnce(ok(pending))
      .mockResolvedValueOnce(ok({ ...pending, status: "aborted" }));
    expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap().status).toBe("aborted");
    expect(completePublish).toHaveBeenCalledTimes(1);
    expect(abortPublish).toHaveBeenCalledTimes(2);
  });

  test("checks that overlap send one complete", async () => {
    const publishId = await leavePending();
    vi.mocked(getPublishSession).mockResolvedValue(ok(pending));
    vi.mocked(completePublish).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(ok({ site, version: 4 })), 10)),
    );

    const [a, b] = await Promise.all([
      getPublishOutcome(WS, publishId),
      getPublishOutcome(WS, publishId),
    ]);

    expect(a._unsafeUnwrap().status).toBe("completed");
    expect(b._unsafeUnwrap().status).toBe("completed");
    expect(completePublish).toHaveBeenCalledTimes(1);
  });

  test("another session, or another workspace, is only read", async () => {
    const publishId = await leavePending();
    vi.mocked(getPublishSession).mockResolvedValue(ok(pending));

    expect((await getPublishOutcome(WS, "pub_other"))._unsafeUnwrap().status).toBe("pending");
    expect(
      (await getPublishOutcome("0f6f1e44-9c1a-4d7e-8f43-7f6c0a3c9b11", publishId))._unsafeUnwrap().status,
    ).toBe("pending");
    expect(completePublish).not.toHaveBeenCalled();
  });

  test("a session the server reports ended is let go", async () => {
    const publishId = await leavePending();
    vi.mocked(getPublishSession).mockResolvedValueOnce(ok({ ...pending, status: "expired" }));
    expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap().status).toBe("expired");

    vi.mocked(getPublishSession).mockResolvedValueOnce(ok(pending));
    expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap().status).toBe("pending");
    expect(completePublish).not.toHaveBeenCalled();
  });

  test("publishing the workspace again lets the earlier session go", async () => {
    const publishId = await leavePending();
    vi.mocked(completePublish).mockResolvedValue(ok({ site, version: 5 }));
    expect(lastResult(await run()).version).toBe(5);
    vi.mocked(completePublish).mockClear();
    vi.mocked(getPublishSession).mockResolvedValue(ok(pending));

    expect((await getPublishOutcome(WS, publishId))._unsafeUnwrap().status).toBe("pending");
    expect(completePublish).not.toHaveBeenCalled();
  });

  // A check's complete still in flight when the workspace publishes again: the
  // new run must not begin until it settles, else the old session can commit
  // after the new begin and the new complete fails as PUBLISH_CONFLICT.
  const retryInFlight = async () => {
    const publishId = await leavePending();
    vi.mocked(beginPublish).mockClear();
    vi.mocked(getPublishSession).mockResolvedValue(ok(pending));
    let answer!: () => void;
    vi.mocked(completePublish).mockImplementationOnce(
      () => new Promise((resolve) => (answer = () => resolve(ok({ site, version: 5 })))),
    );
    const check = getPublishOutcome(WS, publishId);
    await vi.waitFor(() => expect(completePublish).toHaveBeenCalledTimes(1));
    vi.mocked(completePublish).mockResolvedValue(ok({ site, version: 6 }));
    return { check, answer: () => answer() };
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  test("a publish started while a check's complete is in flight begins only after it settles", async () => {
    const { check, answer } = await retryInFlight();

    const publishing = run();
    await settle();
    expect(beginPublish).not.toHaveBeenCalled();

    answer();
    expect((await check)._unsafeUnwrap()).toMatchObject({ status: "completed", resultVersion: 5 });
    expect(lastResult(await publishing).version).toBe(6);
    expect(beginPublish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(completePublish).mock.calls.map(([id]) => id)).toEqual(["pub_1", "pub_1"]);
  });

  test("cancelling a publish that waits on a check does not free the next one to begin", async () => {
    const { check, answer } = await retryInFlight();

    const cancelled: PublishEvent[] = [];
    for await (const event of publishWorkspace(WS, { signal: new AbortController().signal })) {
      cancelled.push(event);
      if (event.type === "step" && event.step === "checking") cancelPublish(WS);
    }
    expect(lastError(cancelled).code).toBe("CANCELLED");

    const publishing = run();
    await settle();
    expect(beginPublish).not.toHaveBeenCalled();

    answer();
    await check;
    expect(lastResult(await publishing).version).toBe(6);
  });
});

describe("publishWorkspace: staging", () => {
  test("is removed on success", async () => {
    let seen: string[] = [];
    vi.mocked(completePublish).mockImplementationOnce(async () => {
      seen = await stagingDirs();
      return ok({ site, version: 4 });
    });

    await run();

    expect(seen).toHaveLength(1);
    expect(await stagingDirs()).toEqual([]);
  });

  test("is removed on failure", async () => {
    vi.mocked(buildWorkspaceSite).mockResolvedValue(
      err({ code: "BUILD_FAILED", message: "vite exited with 1", logTail: ["error"] }),
    );

    const error = lastError(await run());

    expect(error).toEqual({
      code: "BUILD_FAILED",
      message: "vite exited with 1",
      details: { logTail: ["error"] },
    });
    expect(await stagingDirs()).toEqual([]);
  });

  test("is removed on cancel, and the session is aborted", async () => {
    vi.mocked(uploadAll).mockImplementationOnce(
      (_tasks, opts) =>
        new Promise((resolve) =>
          opts?.signal?.addEventListener("abort", () =>
            resolve(err({ code: "CANCELLED", message: "Publishing was cancelled" })),
          ),
        ),
    );

    const events: PublishEvent[] = [];
    for await (const event of publishWorkspace(WS, { signal: new AbortController().signal })) {
      events.push(event);
      if (event.type === "upload-progress") expect(cancelPublish(WS)).toBe(true);
    }

    expect(lastError(events)).toEqual({
      code: "CANCELLED",
      message: "Publishing was cancelled.",
    });
    expect(abortPublish).toHaveBeenCalledWith("pub_1");
    expect(completePublish).not.toHaveBeenCalled();
    expect(await stagingDirs()).toEqual([]);
  });

  test("the caller's signal cancels before finishing", async () => {
    const caller = new AbortController();
    buildHook = () => caller.abort();

    const error = lastError(await run({ signal: caller.signal }));

    expect(error.code).toBe("CANCELLED");
    expect(beginPublish).not.toHaveBeenCalled();
    expect(await stagingDirs()).toEqual([]);
  });

  test("staging gets the byte budget and the signal, and packing gets the signal", async () => {
    const caller = new AbortController();
    await run({ signal: caller.signal });

    const stageOpts = vi.mocked(stageSnapshot).mock.calls[0]![2];
    expect(stageOpts?.maxBytes).toBe(1000 * MiB);
    expect(stageOpts?.signal).toBeInstanceOf(AbortSignal);
    const packOpts = vi.mocked(packSnapshot).mock.calls[0]![2];
    expect(packOpts?.signal).toBe(stageOpts?.signal);
  });

  test("files that grew past the budget while staging → PUBLISH_TOO_LARGE with the plan's largest", async () => {
    vi.mocked(scanWorkspace).mockImplementation(async (sourceDir) =>
      ok({
        sourceDir,
        files: [
          { path: "a.bin", absPath: "/ws/a.bin", size: 5, mode: 0o644, viaSymlink: false, dev: 1, ino: 1 },
          { path: "b.bin", absPath: "/ws/b.bin", size: 9, mode: 0o644, viaSymlink: false, dev: 1, ino: 2 },
        ],
        excluded,
      } satisfies SnapshotPlan),
    );
    vi.mocked(stageSnapshot).mockResolvedValueOnce(
      err({ code: "TOO_LARGE", message: "The files add up to more than 1048576000 bytes" }),
    );

    const error = lastError(await run());

    expect(error.code).toBe("PUBLISH_TOO_LARGE");
    expect(error.details?.largestFiles).toEqual([
      { path: "b.bin", size: 9 },
      { path: "a.bin", size: 5 },
    ]);
    expect(packSnapshot).not.toHaveBeenCalled();
    expect(await stagingDirs()).toEqual([]);
  });

  test("a cancel during staging stops before packing", async () => {
    const caller = new AbortController();
    stageHook = () => caller.abort();

    const error = lastError(await run({ signal: caller.signal }));

    expect(error.code).toBe("CANCELLED");
    expect(packSnapshot).not.toHaveBeenCalled();
    expect(await stagingDirs()).toEqual([]);
  });

  test("a thrown error becomes an error event", async () => {
    vi.mocked(packSnapshot).mockRejectedValueOnce(new Error("disk full"));

    const error = lastError(await run());

    expect(error.code).toBe("INTERNAL_ERROR");
    expect(error.message).toContain("disk full");
    expect(await stagingDirs()).toEqual([]);
  });

  test("pack's TOO_LARGE (manifest.json over its cap) names file count and paths, not bytes", async () => {
    vi.mocked(packSnapshot).mockResolvedValueOnce(
      err({ code: "TOO_LARGE", message: "manifest.json would be 40000000 bytes" }),
    );

    const error = lastError(await run());

    expect(error.code).toBe("PUBLISH_TOO_LARGE");
    expect(error.message).toContain("too many files");
    expect(error.details?.fileCount).toEqual(expect.any(Number));
    expect(error.details?.limitBytes).toBeUndefined();
    expect(await stagingDirs()).toEqual([]);
  });
});

describe("error mapping", () => {
  const cloud = (status: number, code: string, details?: unknown): CloudError => ({
    status,
    code,
    message: `server says ${code}`,
    ...(details !== undefined ? { details } : {}),
  });

  test.each<[number, string, PublishErrorCode]>([
    [413, "PUBLISH_TOO_LARGE", "PUBLISH_TOO_LARGE"],
    [413, "SITE_TOO_LARGE", "SITE_TOO_LARGE"],
    [413, "QUOTA_EXCEEDED", "QUOTA_EXCEEDED"],
    [403, "SITE_LIMIT", "SITE_LIMIT"],
    [422, "INVALID_PATH", "SNAPSHOT_FAILED"],
    [400, "INVALID_REQUEST", "INTERNAL_ERROR"],
    [403, "REMIX_DISABLED", "INTERNAL_ERROR"],
    [404, "PUBLISH_NOT_FOUND", "INTERNAL_ERROR"],
    [404, "SITE_NOT_FOUND", "INTERNAL_ERROR"],
    [409, "UPLOAD_INCOMPLETE", "UPLOAD_FAILED"],
    [409, "PUBLISH_CONFLICT", "PUBLISH_CONFLICT"],
    [409, "PUBLISH_IN_PROGRESS", "PUBLISH_IN_PROGRESS"],
    [410, "PUBLISH_EXPIRED", "PUBLISH_EXPIRED"],
    [429, "RATE_LIMITED", "RATE_LIMITED"],
    [500, "SLUG_ALLOCATION_FAILED", "SERVER_ERROR"],
    [500, "STORAGE_MISCONFIGURED", "SERVER_ERROR"],
    [500, "CONFIG_INVALID", "SERVER_ERROR"],
    [500, "STORAGE_FAILED", "SERVER_ERROR"],
    [500, "PUBLISH_STORE_FAILED", "SERVER_ERROR"],
    [500, "INTERNAL_ERROR", "SERVER_ERROR"],
    [503, "SOMETHING_NEW", "SERVER_ERROR"],
    [401, "SIGNED_OUT", "SIGNED_OUT"],
    [502, "SERVER_UNREACHABLE", "SERVER_UNREACHABLE"],
  ])("server %i %s → %s", (status, code, expected) => {
    expect(mapCloudError(cloud(status, code)).code).toBe(expected);
  });

  test("server details are carried over", () => {
    expect(mapCloudError(cloud(403, "SITE_LIMIT", { limit: 50 }))).toEqual({
      code: "SITE_LIMIT",
      message: "You have reached the limit of 50 published canvases.",
      details: { siteLimit: 50 },
    });
    expect(mapCloudError(cloud(422, "INVALID_PATH", { paths: ["a\\b"] })).details).toEqual({
      paths: ["a\\b"],
    });
    expect(
      mapCloudError(cloud(413, "PUBLISH_TOO_LARGE", { limitBytes: 1, snapshotBytes: 2, junk: "x" }), manifest)
        .details,
    ).toEqual({
      limitBytes: 1,
      snapshotBytes: 2,
      largestFiles: [
        { path: "public/big.bin", size: 2 * MiB },
        { path: "src/App.tsx", size: 500 },
      ],
    });
    expect(mapCloudError(cloud(400, "INVALID_REQUEST")).message).toContain("INVALID_REQUEST");
    expect(mapCloudError(cloud(409, "UPLOAD_INCOMPLETE")).message).toBe(
      "Some uploads did not arrive. Publish again.",
    );
  });

  test("begin refusals about what waits on the server carry their reason, not quota or size copy", () => {
    const pending = mapCloudError(
      cloud(413, "QUOTA_EXCEEDED", {
        reason: "pending-site",
        quotaBytes: 1024,
        usedBytes: 1000,
        publishBytes: 100,
      }),
      manifest,
    );
    expect(pending.code).toBe("QUOTA_EXCEEDED");
    expect(pending.message).not.toContain("storage quota");
    expect(pending.details).toEqual({
      reason: "pending-site",
      quotaBytes: 1024,
      usedBytes: 1000,
      publishBytes: 100,
    });

    // The account's published sites, as a whole: their own copy, not the
    // storage quota's.
    for (const [reason, message] of [
      ["site-storage", "Your published sites use all the storage they are allowed."],
      ["site-files", "Your published sites have too many files between them."],
    ] as const) {
      const refused = mapCloudError(
        cloud(413, "QUOTA_EXCEEDED", {
          reason,
          quotaBytes: 4096,
          usedBytes: 4000,
          publishBytes: 200,
        }),
        manifest,
      );
      expect(refused).toEqual({
        code: "QUOTA_EXCEEDED",
        message,
        details: { reason, quotaBytes: 4096, usedBytes: 4000, publishBytes: 200 },
      });
    }

    // A site size refusal is only ever about this canvas's own site: the
    // site's files are stored by content, so nothing an earlier version left
    // behind counts against it, and any reason is ignored.
    const site = mapCloudError(
      cloud(413, "SITE_TOO_LARGE", { reason: "stored", limitBytes: 10, siteBytes: 11, siteFileCount: 6 }),
    );
    expect(site).toEqual({
      code: "SITE_TOO_LARGE",
      message: "The built site is too large to publish.",
      details: { limitBytes: 10, siteBytes: 11, siteFileCount: 6 },
    });

    const open = mapCloudError(cloud(429, "RATE_LIMITED", { reason: "open-sessions", limit: 10, open: 10 }));
    expect(open.code).toBe("RATE_LIMITED");
    expect(open.message).toContain("unfinished publishes");
    expect(open.message).not.toContain("minute");
    expect(open.details).toEqual({ reason: "open-sessions" });

    // Without a reason, the plain copy stays.
    expect(mapCloudError(cloud(413, "QUOTA_EXCEEDED")).message).toContain("storage quota");
    expect(mapCloudError(cloud(429, "RATE_LIMITED")).message).toContain("minute");
  });

  test.each<[SnapshotError["code"], PublishErrorCode]>([
    ["CASE_COLLISION", "CASE_COLLISION"],
    ["SOURCE_MISSING", "WORKSPACE_NOT_FOUND"],
    ["SCAN_FAILED", "SNAPSHOT_FAILED"],
    ["STAGE_FAILED", "SNAPSHOT_FAILED"],
    ["PACK_FAILED", "SNAPSHOT_FAILED"],
    ["TOO_LARGE", "PUBLISH_TOO_LARGE"],
    ["CANCELLED", "CANCELLED"],
  ])("snapshot %s → %s", (code, expected) => {
    expect(mapSnapshotError({ code, message: "m" }).code).toBe(expected);
  });

  test("snapshot paths are carried over", () => {
    expect(
      mapSnapshotError({ code: "CASE_COLLISION", message: "m", paths: [["README.md", "Readme.md"]] })
        .details,
    ).toEqual({ collisions: [["README.md", "Readme.md"]] });
    expect(mapSnapshotError({ code: "STAGE_FAILED", message: "m", paths: ["src/a.ts"] }).details).toEqual({
      paths: ["src/a.ts"],
    });
  });

  test.each<[SiteBuildError["code"], PublishErrorCode]>([
    ["DEPENDENCIES_MISSING", "DEPENDENCIES_MISSING"],
    ["BUILD_FAILED", "BUILD_FAILED"],
    ["RESOURCES_MISSING", "BUILD_FAILED"],
    ["SITE_ASSEMBLY_FAILED", "BUILD_FAILED"],
    ["BUILD_TIMEOUT", "BUILD_FAILED"],
    ["CANCELLED", "CANCELLED"],
  ])("site build %s → %s", (code, expected) => {
    expect(mapSiteBuildError({ code, message: "m" }).code).toBe(expected);
  });

  test("a build timeout says so", () => {
    expect(mapSiteBuildError({ code: "BUILD_TIMEOUT", message: "m", logTail: ["x"] }).details).toEqual({
      logTail: ["x"],
      timedOut: true,
    });
  });

  test("a snapshot error in the flow maps and stops before the build", async () => {
    vi.mocked(scanWorkspace).mockResolvedValueOnce(
      err({ code: "CASE_COLLISION", message: "collide", paths: [["a.ts", "A.ts"]] }),
    );

    const error = lastError(await run());

    expect(error.code).toBe("CASE_COLLISION");
    expect(error.details?.collisions).toEqual([["a.ts", "A.ts"]]);
    expect(buildWorkspaceSite).not.toHaveBeenCalled();
  });

  test("a server INVALID_PATH at begin maps to SNAPSHOT_FAILED", async () => {
    vi.mocked(beginPublish).mockResolvedValue(
      err({ status: 422, code: "INVALID_PATH", message: "bad", details: { paths: ["x/.hidden"] } }),
    );

    const error = lastError(await run());

    expect(error).toMatchObject({ code: "SNAPSHOT_FAILED", details: { paths: ["x/.hidden"] } });
  });
});

describe("site status", () => {
  test("signed out → null", async () => {
    vi.mocked(fetchSiteStatus).mockResolvedValue(
      err({ status: 401, code: "SIGNED_OUT", message: "Not signed in" }),
    );
    expect((await getPublishStatus(WS))._unsafeUnwrap()).toBeNull();
  });

  test("returns the server's status", async () => {
    vi.mocked(fetchSiteStatus).mockResolvedValue(ok(site));
    expect((await getPublishStatus(WS))._unsafeUnwrap()).toEqual(site);
  });

  test("setAllowRemix patches the workspace's site", async () => {
    vi.mocked(fetchSiteStatus).mockResolvedValue(ok(site));
    vi.mocked(patchSite).mockResolvedValue(ok({ ...site, allowRemix: false }));

    const result = await setAllowRemix(WS, false);

    expect(result._unsafeUnwrap().allowRemix).toBe(false);
    expect(patchSite).toHaveBeenCalledWith("site_abc", { allowRemix: false });
  });

  test("setAllowRemix on a never-published canvas fails without patching", async () => {
    vi.mocked(fetchSiteStatus).mockResolvedValue(ok(null));
    expect((await setAllowRemix(WS, false)).isErr()).toBe(true);
    expect(patchSite).not.toHaveBeenCalled();
  });
});
