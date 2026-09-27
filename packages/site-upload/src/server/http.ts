import { ERROR_STATUS, SiteUploadError, type ErrorBody } from "../protocol/errors";
import { MAX_PLAN_BODY_BYTES } from "../protocol/limits";
import type { SiteStore } from "./store";

export type UploadTarget = {
  site: string;
  publishId: string;
  /** The part of the URL after the publish's base: "plan", "commit" or "files/<sha256>". */
  path: string;
};

/**
 * Handles the upload API for one publish. The caller routes to it after
 * authenticating the request and checking the user owns `site`.
 *
 *   POST plan            body: manifest JSON → { missing: string[] }
 *   PUT  files/<sha256>  body: the file's bytes, with Content-Length → { ok: true }
 *   POST commit          → { publishId, previous, alreadyCommitted }
 *
 * Both POSTs must say Content-Type: application/json. That makes every route
 * a request a browser only sends cross-origin after a CORS preflight, so a web
 * page can't forge a plan or commit with the user's cookies.
 */
export async function handleUpload(
  store: SiteStore,
  request: Request,
  { site, publishId, path }: UploadTarget,
): Promise<Response> {
  try {
    if (path === "plan") {
      requireMethod(request, "POST");
      requireJsonType(request);
      const body = await readJson(request, MAX_PLAN_BODY_BYTES);
      return json(200, await store.plan(site, publishId, body));
    }
    if (path === "commit") {
      requireMethod(request, "POST");
      requireJsonType(request);
      return json(200, await store.commit(site, publishId));
    }
    const file = /^files\/([^/]+)$/.exec(path);
    if (file) {
      requireMethod(request, "PUT");
      const length = parseContentLength(request.headers.get("content-length"));
      await store.putFile(site, publishId, file[1]!, request.body, length);
      return json(200, { ok: true });
    }
    throw new SiteUploadError("NOT_FOUND", "Unknown upload route");
  } catch (err) {
    return errorResponse(err);
  }
}

export function errorResponse(err: unknown): Response {
  if (!(err instanceof SiteUploadError)) {
    return json(500, { error: { code: "INTERNAL", message: "Internal error" } } satisfies ErrorBody);
  }
  const body: ErrorBody = { error: { code: err.code, message: err.message } };
  if (err.details) body.error.details = err.details;
  const response = json(ERROR_STATUS[err.code], body);
  const allow = err.details?.allow;
  if (typeof allow === "string") response.headers.set("allow", allow);
  return response;
}

function requireMethod(request: Request, method: string) {
  if (request.method !== method) {
    throw new SiteUploadError("METHOD_NOT_ALLOWED", `Use ${method}`, { allow: method });
  }
}

function requireJsonType(request: Request) {
  const type = request.headers.get("content-type")?.split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") {
    throw new SiteUploadError("UNSUPPORTED_MEDIA_TYPE", "Send Content-Type: application/json");
  }
}

function parseContentLength(header: string | null): number | null {
  if (header === null || !/^\d{1,15}$/.test(header.trim())) return null;
  return Number(header.trim());
}

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = parseContentLength(request.headers.get("content-length"));
  if (declared !== null && declared > maxBytes) throw tooLarge(maxBytes);
  if (!request.body) throw new SiteUploadError("INVALID_REQUEST", "The request has no body");

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new SiteUploadError("INVALID_REQUEST", "The request body is not valid JSON");
  }
}

const tooLarge = (maxBytes: number) =>
  new SiteUploadError("TOO_LARGE", `The request body is over ${maxBytes} bytes`, {
    reason: "body",
    limit: maxBytes,
  });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
