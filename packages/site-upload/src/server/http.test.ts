import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestWorker, manifestOf, sha256, summarize, uniqueSite, type TestWorker } from "../../test/helpers";
import { SiteUploadError } from "../protocol/errors";
import { MAX_PLAN_BODY_BYTES } from "../protocol/limits";
import { errorResponse, handleUpload } from "./http";
import { SiteStore } from "./store";

// PUTs stream the request body into R2, which only works inside workerd;
// successful uploads are covered by the end-to-end tests.

let env: TestWorker;
let store: SiteStore;
let site: string;

beforeAll(async () => {
  env = await startTestWorker();
});
afterAll(() => env.close());

beforeEach(() => {
  store = new SiteStore({ bucket: env.bucket });
  site = uniqueSite();
});

const call = async (path: string, init: RequestInit = {}) =>
  summarize(await handleUpload(store, new Request(`https://api.test/u/${path}`, init), { site, publishId: "p1", path }));

const post = (path: string, body?: string) =>
  call(path, { method: "POST", body, headers: { "content-type": "application/json" } });

describe("handleUpload", () => {
  it("plans, then reports missing files on commit", async () => {
    expect({
      plan: await post("plan", JSON.stringify(manifestOf({ "index.html": "x", "a.txt": "a" }))),
      commit: await post("commit"),
    }).toMatchInlineSnapshot(`
      {
        "commit": {
          "body": {
            "error": {
              "code": "MISSING_FILES",
              "details": {
                "missing": [
                  "sha(x)",
                  "sha(a)",
                ],
              },
              "message": "2 files are not uploaded yet",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 409,
        },
        "plan": {
          "body": {
            "missing": [
              "sha(x)",
              "sha(a)",
            ],
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 200,
        },
      }
    `);
  });

  it("rejects bad plan bodies", async () => {
    expect({
      "not JSON": await post("plan", "{nope"),
      "no body": await call("plan", { method: "POST", headers: { "content-type": "application/json" } }),
      "declared too large": await call("plan", {
        method: "POST",
        body: "{}",
        headers: { "content-type": "application/json", "content-length": String(MAX_PLAN_BODY_BYTES + 1) },
      }),
    }).toMatchInlineSnapshot(`
      {
        "declared too large": {
          "body": {
            "error": {
              "code": "TOO_LARGE",
              "details": {
                "limit": 16777216,
                "reason": "body",
              },
              "message": "The request body is over 16777216 bytes",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 413,
        },
        "no body": {
          "body": {
            "error": {
              "code": "INVALID_REQUEST",
              "message": "The request has no body",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
        "not JSON": {
          "body": {
            "error": {
              "code": "INVALID_REQUEST",
              "message": "The request body is not valid JSON",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 400,
        },
      }
    `);
  });

  it("stops reading a plan body once it passes the limit", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x20);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 40) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const res = await call("plan", {
      method: "POST",
      body,
      duplex: "half",
      headers: { "content-type": "application/json" },
    } as RequestInit);
    expect({ status: res.status, pulledMiB: pulled }).toMatchInlineSnapshot(`
      {
        "pulledMiB": 17,
        "status": 413,
      }
    `);
  });

  it("refuses plans and commits a browser would send cross-origin without a preflight", async () => {
    const manifest = JSON.stringify(manifestOf({ "index.html": "x" }));
    const results = {
      "plan as text/plain": await call("plan", { method: "POST", body: manifest, headers: { "content-type": "text/plain" } }),
      "plan as a form": await call("plan", {
        method: "POST",
        body: "a=b",
        headers: { "content-type": "application/x-www-form-urlencoded" },
      }),
      "commit with no type": await call("commit", { method: "POST" }),
      "plan as JSON with charset": (await call("plan", {
        method: "POST",
        body: manifest,
        headers: { "content-type": "Application/JSON; charset=utf-8" },
      })).status,
    };
    expect(results).toMatchInlineSnapshot(`
      {
        "commit with no type": {
          "body": {
            "error": {
              "code": "UNSUPPORTED_MEDIA_TYPE",
              "message": "Send Content-Type: application/json",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 415,
        },
        "plan as JSON with charset": 200,
        "plan as a form": {
          "body": {
            "error": {
              "code": "UNSUPPORTED_MEDIA_TYPE",
              "message": "Send Content-Type: application/json",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 415,
        },
        "plan as text/plain": {
          "body": {
            "error": {
              "code": "UNSUPPORTED_MEDIA_TYPE",
              "message": "Send Content-Type: application/json",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 415,
        },
      }
    `);
  });

  it("checks methods and routes", async () => {
    expect({
      "GET plan": await call("plan", { method: "GET" }),
      "POST file": await call(`files/${sha256("x")}`, { method: "POST" }),
      "unknown route": await post("nope"),
      "nested file path": await call("files/a/b", { method: "PUT" }),
    }).toMatchInlineSnapshot(`
      {
        "GET plan": {
          "body": {
            "error": {
              "code": "METHOD_NOT_ALLOWED",
              "details": {
                "allow": "POST",
              },
              "message": "Use POST",
            },
          },
          "headers": {
            "allow": "POST",
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 405,
        },
        "POST file": {
          "body": {
            "error": {
              "code": "METHOD_NOT_ALLOWED",
              "details": {
                "allow": "PUT",
              },
              "message": "Use PUT",
            },
          },
          "headers": {
            "allow": "PUT",
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 405,
        },
        "nested file path": {
          "body": {
            "error": {
              "code": "NOT_FOUND",
              "message": "Unknown upload route",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 404,
        },
        "unknown route": {
          "body": {
            "error": {
              "code": "NOT_FOUND",
              "message": "Unknown upload route",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 404,
        },
      }
    `);
  });

  it("requires Content-Length on file uploads", async () => {
    await post("plan", JSON.stringify(manifestOf({ "index.html": "x" })));
    expect(await call(`files/${sha256("x")}`, { method: "PUT" })).toMatchInlineSnapshot(`
      {
        "body": {
          "error": {
            "code": "LENGTH_REQUIRED",
            "message": "A Content-Length header is required",
          },
        },
        "headers": {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        },
        "status": 411,
      }
    `);
  });
});

describe("errorResponse", () => {
  it("hides unexpected errors and maps codes to statuses", async () => {
    expect({
      unexpected: await summarize(errorResponse(new Error("secret internals"))),
      planExpired: (await summarize(errorResponse(new SiteUploadError("PLAN_EXPIRED", "x")))).status,
      hashMismatch: (await summarize(errorResponse(new SiteUploadError("HASH_MISMATCH", "x")))).status,
      lengthRequired: (await summarize(errorResponse(new SiteUploadError("LENGTH_REQUIRED", "x")))).status,
    }).toMatchInlineSnapshot(`
      {
        "hashMismatch": 400,
        "lengthRequired": 411,
        "planExpired": 410,
        "unexpected": {
          "body": {
            "error": {
              "code": "INTERNAL",
              "message": "Internal error",
            },
          },
          "headers": {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
          "status": 500,
        },
      }
    `);
  });
});
