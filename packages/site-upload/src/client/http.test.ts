import { describe, expect, it } from "vitest";
import { manifestOf, readable, sha256, thrown } from "../../test/helpers";
import { createHttpTransport } from "./http";

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? "GET",
      url: String(input),
      headers: Object.fromEntries(new Headers(init.headers)),
      body: init.body instanceof Blob ? `<Blob ${init.body.size} bytes>` : init.body,
    };
    calls.push(call);
    return respond(call);
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const signal = new AbortController().signal;
const base = "https://api.test/publish/p1";

describe("createHttpTransport", () => {
  it("sends plan, file and commit requests to the base URL", async () => {
    const hash = sha256("x");
    const { calls, fetch } = fakeFetch((call) => {
      if (call.url.endsWith("/plan")) return json(200, { missing: [hash] });
      if (call.url.endsWith("/commit")) return json(200, { publishId: "p1", previous: null, alreadyCommitted: false });
      return json(200, { ok: true });
    });
    const transport = createHttpTransport({ baseUrl: `${base}/`, fetch, headers: { authorization: "Bearer t" } });

    const results = {
      plan: await transport.plan(manifestOf({ "index.html": "x" }), signal),
      put: await transport.put(hash, new Blob(["x"]), signal),
      commit: await transport.commit(signal),
    };
    expect(readable({ results, calls })).toMatchInlineSnapshot(`
      {
        "calls": [
          {
            "body": "{"v":1,"files":{"index.html":{"h":"sha(x)","s":1}}}",
            "headers": {
              "authorization": "Bearer t",
              "content-type": "application/json",
            },
            "method": "POST",
            "url": "https://api.test/publish/p1/plan",
          },
          {
            "body": "<Blob 1 bytes>",
            "headers": {
              "authorization": "Bearer t",
              "content-type": "application/octet-stream",
            },
            "method": "PUT",
            "url": "https://api.test/publish/p1/files/sha(x)",
          },
          {
            "body": undefined,
            "headers": {
              "authorization": "Bearer t",
              "content-type": "application/json",
            },
            "method": "POST",
            "url": "https://api.test/publish/p1/commit",
          },
        ],
        "results": {
          "commit": {
            "alreadyCommitted": false,
            "previous": null,
            "publishId": "p1",
          },
          "plan": {
            "missing": [
              "sha(x)",
            ],
          },
          "put": undefined,
        },
      }
    `);
  });

  it("asks for headers on every request", async () => {
    let n = 0;
    const { calls, fetch } = fakeFetch(() => json(200, { missing: [] }));
    const transport = createHttpTransport({
      baseUrl: base,
      fetch,
      headers: async () => ({ authorization: `Bearer ${++n}` }),
    });
    await transport.plan(manifestOf({ a: "x" }), signal);
    await transport.plan(manifestOf({ a: "x" }), signal);
    expect(calls.map((c) => c.headers.authorization)).toMatchInlineSnapshot(`
      [
        "Bearer 1",
        "Bearer 2",
      ]
    `);
  });

  it("turns server errors into SiteUploadErrors with the server's code", async () => {
    const { fetch } = fakeFetch(() =>
      json(409, { error: { code: "MISSING_FILES", message: "2 files are not uploaded yet", details: { missing: ["a"] } } }),
    );
    expect(await thrown(createHttpTransport({ baseUrl: base, fetch }).commit(signal))).toMatchInlineSnapshot(`
      {
        "code": "MISSING_FILES",
        "details": {
          "missing": [
            "a",
          ],
        },
        "error": "SiteUploadError",
        "message": "2 files are not uploaded yet",
        "status": 409,
      }
    `);
  });

  it("decides retry and throttle from the status when the body isn't ours", async () => {
    const outcomes: Record<number, unknown> = {};
    for (const status of [400, 404, 408, 429, 500, 501, 502, 503, 504]) {
      const { fetch } = fakeFetch(() => new Response("<html>gateway</html>", { status }));
      const { code, retryable, throttle } = await thrown(createHttpTransport({ baseUrl: base, fetch }).commit(signal));
      outcomes[status] = `${code} retryable=${retryable ?? false} throttle=${throttle ?? false}`;
    }
    expect(outcomes).toMatchInlineSnapshot(`
      {
        "400": "HTTP_ERROR retryable=false throttle=false",
        "404": "HTTP_ERROR retryable=false throttle=false",
        "408": "HTTP_ERROR retryable=true throttle=false",
        "429": "HTTP_ERROR retryable=true throttle=true",
        "500": "HTTP_ERROR retryable=true throttle=false",
        "501": "HTTP_ERROR retryable=false throttle=false",
        "502": "HTTP_ERROR retryable=true throttle=true",
        "503": "HTTP_ERROR retryable=true throttle=true",
        "504": "HTTP_ERROR retryable=true throttle=true",
      }
    `);
  });

  it("reads Retry-After in seconds or as a date, capped at a minute", async () => {
    const retryAfter = async (value: string) => {
      const { fetch } = fakeFetch(() => json(503, {}, { "retry-after": value }));
      return (await thrown(createHttpTransport({ baseUrl: base, fetch }).commit(signal))).retryAfterMs;
    };
    const inTenSeconds = (await retryAfter(new Date(Date.now() + 10_000).toUTCString())) ?? -1;
    expect({
      seconds: await retryAfter("2"),
      "over a minute": await retryAfter("100000"),
      "date ~10s away is 8-10s": inTenSeconds > 8000 && inTenSeconds <= 10_000,
      garbage: await retryAfter("soon"),
    }).toMatchInlineSnapshot(`
      {
        "date ~10s away is 8-10s": true,
        "garbage": undefined,
        "over a minute": 60000,
        "seconds": 2000,
      }
    `);
  });

  it("marks network failures retryable, but passes an abort through", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const controller = new AbortController();
    const aborting = (async () => {
      controller.abort(new Error("user cancelled"));
      throw new DOMException("aborted", "AbortError");
    }) as typeof globalThis.fetch;
    expect({
      network: await thrown(createHttpTransport({ baseUrl: base, fetch: failing }).commit(signal)),
      aborted: await thrown(createHttpTransport({ baseUrl: base, fetch: aborting }).commit(controller.signal)),
    }).toMatchInlineSnapshot(`
      {
        "aborted": {
          "error": "Error",
          "message": "user cancelled",
        },
        "network": {
          "code": "NETWORK",
          "error": "SiteUploadError",
          "message": "Couldn't reach the server: fetch failed",
          "retryable": true,
        },
      }
    `);
  });

  it("rejects malformed success replies", async () => {
    const replying = (response: () => Response) =>
      createHttpTransport({ baseUrl: base, fetch: fakeFetch(response).fetch });
    const manifest = manifestOf({ a: "x" });
    expect({
      "missing has a bad hash": await thrown(replying(() => json(200, { missing: ["nothex"] })).plan(manifest, signal)),
      "no missing list": await thrown(replying(() => json(200, {})).plan(manifest, signal)),
      "null commit": await thrown(replying(() => json(200, null)).commit(signal)),
      "not JSON": await thrown(replying(() => new Response("ok")).commit(signal)),
    }).toMatchInlineSnapshot(`
      {
        "missing has a bad hash": {
          "code": "BAD_RESPONSE",
          "error": "SiteUploadError",
          "message": "The plan reply has no valid missing list",
        },
        "no missing list": {
          "code": "BAD_RESPONSE",
          "error": "SiteUploadError",
          "message": "The plan reply has no valid missing list",
        },
        "not JSON": {
          "code": "BAD_RESPONSE",
          "error": "SiteUploadError",
          "message": "The server's reply was not JSON",
          "retryable": true,
          "status": 200,
        },
        "null commit": {
          "code": "BAD_RESPONSE",
          "error": "SiteUploadError",
          "message": "The commit reply is malformed",
        },
      }
    `);
  });
});

describe("createHttpTransport signals", () => {
  it("passes the caller's abort signal to every request", async () => {
    const seen: boolean[] = [];
    const controller = new AbortController();
    const fetch = (async (_input: string | URL | Request, init: RequestInit = {}) => {
      seen.push(init.signal === controller.signal);
      return json(200, (init.method === "PUT" ? { ok: true } : String(_input).endsWith("/plan") ? { missing: [] } : { publishId: "p1", previous: null, alreadyCommitted: false }));
    }) as typeof globalThis.fetch;
    const transport = createHttpTransport({ baseUrl: base, fetch });
    await transport.plan(manifestOf({ a: "x" }), controller.signal);
    await transport.put(sha256("x"), new Blob(["x"]), controller.signal);
    await transport.commit(controller.signal);
    expect(seen).toMatchInlineSnapshot(`
      [
        true,
        true,
        true,
      ]
    `);
  });
});
