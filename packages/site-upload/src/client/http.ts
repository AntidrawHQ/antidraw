import { SiteUploadError, type ErrorCode } from "../protocol/errors";
import { isHash, type CommitResult, type Manifest, type PlanResult } from "../protocol/manifest";

/** How the uploader talks to the server. createHttpTransport is the real one. */
export interface UploadTransport {
  plan(manifest: Manifest, signal: AbortSignal): Promise<PlanResult>;
  put(hash: string, body: Blob, signal: AbortSignal): Promise<void>;
  commit(signal: AbortSignal): Promise<CommitResult>;
}

type HeadersInit = ConstructorParameters<typeof Headers>[0];

export type HttpTransportOptions = {
  /** The publish's upload base, e.g. https://api.example.com/publish/<id>. */
  baseUrl: string;
  /** Sent with every request; a function is called per request (for fresh tokens). */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  fetch?: typeof fetch;
};

const MAX_RETRY_AFTER_MS = 60_000;

export function createHttpTransport(options: HttpTransportOptions): UploadTransport {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;

  const send = async (path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> => {
    const headers = new Headers(
      typeof options.headers === "function" ? await options.headers() : options.headers,
    );
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));

    let response: Response;
    try {
      response = await doFetch(`${base}/${path}`, { ...init, headers, signal });
    } catch (err) {
      if (signal.aborted) throw signal.reason;
      throw new SiteUploadError(
        "NETWORK",
        `Couldn't reach the server: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        { retryable: true },
        { cause: err },
      );
    }
    if (!response.ok) throw await responseError(response);
    try {
      return await response.json();
    } catch (err) {
      if (signal.aborted) throw signal.reason;
      throw new SiteUploadError("BAD_RESPONSE", "The server's reply was not JSON", undefined, {
        status: response.status,
        retryable: true,
      });
    }
  };

  return {
    async plan(manifest, signal) {
      const body = await send(
        "plan",
        { method: "POST", body: JSON.stringify(manifest), headers: { "content-type": "application/json" } },
        signal,
      );
      const missing = (body as { missing?: unknown } | null)?.missing;
      if (!Array.isArray(missing) || !missing.every(isHash)) {
        throw new SiteUploadError("BAD_RESPONSE", "The plan reply has no valid missing list");
      }
      return { missing };
    },
    async put(hash, body, signal) {
      await send(
        `files/${hash}`,
        { method: "PUT", body, headers: { "content-type": "application/octet-stream" } },
        signal,
      );
    },
    async commit(signal) {
      const body = (await send("commit", { method: "POST" }, signal)) as Partial<CommitResult> | null;
      if (!body || typeof body.publishId !== "string") {
        throw new SiteUploadError("BAD_RESPONSE", "The commit reply is malformed");
      }
      return {
        publishId: body.publishId,
        previous: typeof body.previous === "string" ? body.previous : null,
        alreadyCommitted: body.alreadyCommitted === true,
      };
    },
  };
}

async function responseError(response: Response): Promise<SiteUploadError> {
  const status = response.status;
  let code: ErrorCode = "HTTP_ERROR";
  let message = `The server answered ${status}`;
  let details: Record<string, unknown> | undefined;
  try {
    const body = (await response.json()) as {
      error?: { code?: unknown; message?: unknown; details?: unknown };
    };
    if (typeof body.error?.code === "string") code = body.error.code as ErrorCode;
    if (typeof body.error?.message === "string") message = body.error.message;
    if (typeof body.error?.details === "object" && body.error.details !== null) {
      details = body.error.details as Record<string, unknown>;
    }
  } catch {
    // Not our JSON (a gateway page, say); status alone decides.
  }
  const throttle = status === 429 || status === 502 || status === 503 || status === 504;
  const retryable = throttle || status === 408 || (status >= 500 && status !== 501);
  return new SiteUploadError(code, message, details, {
    status,
    retryable,
    throttle,
    retryAfterMs: retryAfter(response.headers.get("retry-after")),
  });
}

function retryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
}
