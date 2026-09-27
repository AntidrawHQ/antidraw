import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { err, ok } from "neverthrow";
import { cloudFetch } from "@/main/services/account.service";
import {
  abortPublish,
  beginPublish,
  completePublish,
  fetchSiteStatus,
  getPublishSession,
  patchSite,
  type BeginPublishRequest,
} from "../cloud-publish";
import { cloudTiming, completeTimeoutFor } from "../deadline";

vi.mock("@/main/services/account.service", () => ({
  cloudFetch: vi.fn(),
}));

const sha = (c: string) => c.repeat(64);

const site = {
  siteId: "site_abc",
  slug: "my-canvas-x7k2p",
  url: "https://my-canvas-x7k2p.antidraw.app",
  headVersion: 3,
  allowRemix: true,
  lastPublishedAt: "2026-09-27T10:00:00.000Z",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const reply = (response: Response) =>
  vi.mocked(cloudFetch).mockResolvedValueOnce(ok(response));

const beginBody: BeginPublishRequest = {
  clientWorkspaceId: "8b0b7b5e-3f4c-4d57-9a55-2c1f2b0e8c11",
  name: "My canvas",
  snapshot: {
    source: { sha256: sha("a"), size: 1234 },
    largeFiles: [],
    fileCount: 12,
    uncompressedBytes: 4567,
  },
  site: {
    files: [
      { path: "preview.html", sha256: sha("1"), size: 10, contentType: "text/html; charset=utf-8", immutable: false },
      { path: "canvas.json", sha256: sha("2"), size: 20, contentType: "application/json; charset=utf-8", immutable: false },
      { path: "index.html", sha256: sha("3"), size: 30, contentType: "text/html; charset=utf-8", immutable: false },
    ],
  },
};

describe("cloud-publish", () => {
  beforeEach(() => {
    vi.mocked(cloudFetch).mockReset();
  });

  test("begin posts JSON to /api/publish/sessions and parses the response", async () => {
    const response = {
      publish: {
        id: "pub_1",
        siteId: "site_abc",
        slug: site.slug,
        url: site.url,
        baseVersion: 3,
        expiresAt: "2026-09-27T12:00:00.000Z",
      },
      uploads: [
        {
          kind: "source",
          sha256: sha("a"),
          size: 1234,
          url: "https://acct.r2.cloudflarestorage.com/antidraw-sources/u/x/source/a.tar.gz?X-Amz-Expires=7200",
          method: "PUT",
          headers: { "content-type": "application/gzip", "content-length": "1234" },
        },
      ],
    };
    reply(json(response));

    const result = await beginPublish(beginBody);

    expect(result._unsafeUnwrap()).toEqual(response);
    const [pathname, init] = vi.mocked(cloudFetch).mock.calls[0]!;
    expect(pathname).toBe("/api/publish/sessions");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual(beginBody);
  });

  test("maps the error envelope, details included", async () => {
    reply(
      json(
        {
          error: {
            code: "QUOTA_EXCEEDED",
            message: "Quota exceeded",
            details: { quotaBytes: 100, usedBytes: 90, publishBytes: 20 },
          },
        },
        413,
      ),
    );

    const result = await beginPublish(beginBody);

    expect(result._unsafeUnwrapErr()).toEqual({
      status: 413,
      code: "QUOTA_EXCEEDED",
      message: "Quota exceeded",
      details: { quotaBytes: 100, usedBytes: 90, publishBytes: 20 },
    });
  });

  test("an envelope without details has none", async () => {
    reply(json({ error: { code: "PUBLISH_CONFLICT", message: "Moved on" } }, 409));

    const result = await completePublish("pub_1");

    expect(result._unsafeUnwrapErr()).toEqual({
      status: 409,
      code: "PUBLISH_CONFLICT",
      message: "Moved on",
    });
  });

  test("SIGNED_OUT and SERVER_UNREACHABLE from cloudFetch pass through", async () => {
    vi.mocked(cloudFetch).mockResolvedValueOnce(
      err({ status: 401, code: "SIGNED_OUT", message: "Not signed in" }),
    );
    vi.mocked(cloudFetch).mockResolvedValueOnce(
      err({ status: 502, code: "SERVER_UNREACHABLE", message: "Couldn't reach the AntiDraw server" }),
    );

    expect((await beginPublish(beginBody))._unsafeUnwrapErr()).toEqual({
      status: 401,
      code: "SIGNED_OUT",
      message: "Not signed in",
    });
    expect((await fetchSiteStatus(beginBody.clientWorkspaceId))._unsafeUnwrapErr()).toEqual({
      status: 502,
      code: "SERVER_UNREACHABLE",
      message: "Couldn't reach the AntiDraw server",
    });
  });

  test("a malformed success response is SERVER_ERROR", async () => {
    reply(json({ publish: { id: "pub_1" }, uploads: "nope" }));

    const result = await beginPublish(beginBody);

    expect(result._unsafeUnwrapErr()).toMatchObject({ code: "SERVER_ERROR", status: 502 });
  });

  test("a non-JSON body is SERVER_ERROR", async () => {
    reply(new Response("<html>bad gateway</html>", { status: 200 }));
    expect((await getPublishSession("pub_1"))._unsafeUnwrapErr().code).toBe("SERVER_ERROR");

    reply(new Response("<html>bad gateway</html>", { status: 503 }));
    expect((await getPublishSession("pub_1"))._unsafeUnwrapErr()).toMatchObject({
      code: "SERVER_ERROR",
      status: 503,
    });
  });

  test("an error status without an envelope keeps its status", async () => {
    reply(json({ something: "else" }, 500));

    const result = await completePublish("pub_1");

    expect(result._unsafeUnwrapErr()).toMatchObject({ status: 500, code: "SERVER_ERROR" });
  });

  test("complete, session, abort, site status and patch hit the documented routes", async () => {
    reply(json({ site, version: 4 }));
    reply(json({ status: "completed", resultVersion: 4, live: true, site }));
    reply(json({ ok: true }));
    reply(json({ site: null }));
    reply(json({ site: { ...site, allowRemix: false } }));

    expect((await completePublish("pub/1"))._unsafeUnwrap()).toEqual({
      site,
      version: 4,
    });
    expect((await getPublishSession("pub_1"))._unsafeUnwrap().status).toBe("completed");
    expect((await abortPublish("pub_1")).isOk()).toBe(true);
    expect((await fetchSiteStatus("8b0b7b5e-3f4c-4d57-9a55-2c1f2b0e8c11"))._unsafeUnwrap()).toBeNull();
    expect((await patchSite("site_abc", { allowRemix: false }))._unsafeUnwrap().allowRemix).toBe(false);

    const calls = vi.mocked(cloudFetch).mock.calls.map(([p, init]) => [init?.method, p]);
    expect(calls).toEqual([
      ["POST", "/api/publish/sessions/pub%2F1/complete"],
      ["GET", "/api/publish/sessions/pub_1"],
      ["POST", "/api/publish/sessions/pub_1/abort"],
      ["GET", "/api/publish/sites?clientWorkspaceId=8b0b7b5e-3f4c-4d57-9a55-2c1f2b0e8c11"],
      ["PATCH", "/api/publish/sites/site_abc"],
    ]);
    // Complete carries nothing: the entry pages were uploaded like any file.
    expect(JSON.parse(vi.mocked(cloudFetch).mock.calls[0]![1]!.body as string)).toEqual({});
    expect(JSON.parse(vi.mocked(cloudFetch).mock.calls[4]![1]!.body as string)).toEqual({
      allowRemix: false,
    });
  });

  describe("time limits and cancel", () => {
    const timing = { ...cloudTiming };
    afterEach(() => Object.assign(cloudTiming, timing));

    // A connection that stalls after connecting: nothing ever answers, and
    // the signal is ignored (as a stalled keychain read or a stuck socket
    // might), so only the request's own bound can end it.
    const stall = () =>
      vi.mocked(cloudFetch).mockImplementationOnce(() => new Promise(() => {}));

    test("a request with no answer ends as SERVER_UNREACHABLE after its time limit", async () => {
      cloudTiming.requestTimeoutMs = 20;
      stall();

      const result = await getPublishSession("pub_1");

      expect(result._unsafeUnwrapErr()).toEqual({
        status: 502,
        code: "SERVER_UNREACHABLE",
        message: "The AntiDraw server took too long to answer",
      });
      const init = vi.mocked(cloudFetch).mock.calls[0]![1]!;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal!.aborted).toBe(true);
    });

    test("a body that stops arriving ends as SERVER_UNREACHABLE too", async () => {
      cloudTiming.requestTimeoutMs = 20;
      const body = new ReadableStream({
        start: (controller) => controller.enqueue(new TextEncoder().encode('{"status":')),
      });
      reply(new Response(body, { status: 200 }));

      const result = await getPublishSession("pub_1");

      expect(result._unsafeUnwrapErr().code).toBe("SERVER_UNREACHABLE");
    });

    test("an aborted fetch is reported as the time limit, not as unreachable", async () => {
      cloudTiming.requestTimeoutMs = 20;
      // What cloudFetch does when fetch throws, abort included.
      vi.mocked(cloudFetch).mockImplementationOnce(
        (_path, init) =>
          new Promise((resolve) =>
            init?.signal?.addEventListener("abort", () =>
              resolve(err({ status: 502, code: "SERVER_UNREACHABLE", message: "Couldn't reach the AntiDraw server" })),
            ),
          ),
      );

      const result = await fetchSiteStatus("8b0b7b5e-3f4c-4d57-9a55-2c1f2b0e8c11");

      expect(result._unsafeUnwrapErr().message).toBe("The AntiDraw server took too long to answer");
    });

    test("begin stops as soon as the caller cancels", async () => {
      stall();
      const caller = new AbortController();

      const pending = beginPublish(beginBody, { signal: caller.signal });
      caller.abort();

      expect((await pending)._unsafeUnwrapErr()).toMatchObject({ code: "CANCELLED" });
    });

    test("complete gets its own, longer time limit", async () => {
      cloudTiming.requestTimeoutMs = 20;
      cloudTiming.completeTimeoutMs = 5_000;
      vi.mocked(cloudFetch).mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve(ok(json({ site, version: 4 }))), 60)),
      );

      const result = await completePublish("pub_1");

      expect(result._unsafeUnwrap().version).toBe(4);
    });

    test("complete's time limit grows with the publish's objects", async () => {
      cloudTiming.requestTimeoutMs = 20;
      cloudTiming.completeTimeoutMs = 20;
      cloudTiming.completePerObjectMs = 1;
      const slow = () =>
        vi.mocked(cloudFetch).mockImplementationOnce(
          () => new Promise((resolve) => setTimeout(() => resolve(ok(json({ site, version: 4 }))), 80)),
        );

      slow();
      expect((await completePublish("pub_1"))._unsafeUnwrapErr().code).toBe("SERVER_UNREACHABLE");
      slow();
      expect((await completePublish("pub_1", 1_000))._unsafeUnwrap().version).toBe(4);
      expect(completeTimeoutFor(6_000)).toBe(20 + 6_000);
    });
  });
});
