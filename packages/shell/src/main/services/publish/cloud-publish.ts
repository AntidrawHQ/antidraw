import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { cloudFetch } from "@/main/services/account.service";
import { ABORTED, cloudTiming, completeTimeoutFor, untilAborted } from "./deadline";

// Typed client for the server's publish API (packages/server, spec §2). The
// schemas mirror packages/server/src/lib/publish.schemas.ts by name; neither
// package imports the other, so a change there must be copied here. Requests
// are built from the local types and not re-validated; responses are parsed,
// and anything that does not parse is a SERVER_ERROR.

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export type BeginPublishRequest = {
  clientWorkspaceId: string;
  name: string;
  // Present only when the user changed the setting; absent keeps the site's.
  allowRemix?: boolean;
  snapshot: {
    source: { sha256: string; size: number };
    largeFiles: { path: string; sha256: string; size: number; mode: 0o644 | 0o755 }[];
    fileCount: number;
    uncompressedBytes: number;
  };
  // Every file of the site, the entry pages (index.html, preview.html,
  // canvas.json) included: the server stores each distinct content once per
  // account and asks only for the contents it does not have yet.
  site: {
    files: {
      path: string;
      sha256: string;
      size: number;
      contentType: string;
      immutable: boolean;
    }[];
  };
};

// One per object the server does not have. A "site" instruction is for a
// site file's content (stored once per sha256, however many paths share it);
// its `path`, when present, is one of those paths.
export const uploadInstruction = z.object({
  kind: z.enum(["source", "blob", "site"]),
  sha256: sha256Hex,
  size: z.number().int().nonnegative(),
  path: z.string().optional(),
  url: z.url(),
  method: z.literal("PUT"),
  headers: z.record(z.string(), z.string()),
});
export type UploadInstruction = z.infer<typeof uploadInstruction>;

export const siteStatus = z.object({
  siteId: z.string(),
  slug: z.string(),
  url: z.url(),
  headVersion: z.number().int().nonnegative(),
  allowRemix: z.boolean(),
  lastPublishedAt: z.iso.datetime().nullable(),
});

export const beginPublishResponse = z.object({
  publish: z.object({
    id: z.string(),
    siteId: z.string(),
    slug: z.string(),
    url: z.url(),
    baseVersion: z.number().int().nonnegative(),
    expiresAt: z.iso.datetime(),
  }),
  uploads: z.array(uploadInstruction),
});
export type BeginPublishResponse = z.infer<typeof beginPublishResponse>;

export const completePublishResponse = z.object({
  site: siteStatus,
  version: z.number().int().positive(),
});
export type CompletePublishResponse = z.infer<typeof completePublishResponse>;

export const publishSessionResponse = z.object({
  status: z.enum(["pending", "completed", "aborted", "expired"]),
  resultVersion: z.number().int().positive().nullable(),
  site: siteStatus,
});
export type PublishSessionResponse = z.infer<typeof publishSessionResponse>;

const siteStatusResponse = z.object({ site: siteStatus.nullable() });
const patchSiteResponse = z.object({ site: siteStatus });
const abortResponse = z.object({ ok: z.literal(true) });

const errorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

// status is the HTTP status, or the AccountError status for SIGNED_OUT (401)
// and SERVER_UNREACHABLE (502), which come from cloudFetch. A request that
// ran out of time is SERVER_UNREACHABLE too; one the caller cancelled is
// CANCELLED (499).
export type CloudError = {
  status: number;
  code: string;
  message: string;
  details?: unknown;
};

const malformed = (status: number): CloudError => ({
  status: status >= 500 ? status : 502,
  code: "SERVER_ERROR",
  message: "The server sent a response the app doesn't understand",
});

// A request stopped by the caller's signal is CANCELLED; one stopped by its
// time limit is SERVER_UNREACHABLE, as good as no answer (complete retries it,
// then asks what became of the session).
const CANCELLED: CloudError = {
  status: 499,
  code: "CANCELLED",
  message: "The request was cancelled",
};
const TIMED_OUT: CloudError = {
  status: 502,
  code: "SERVER_UNREACHABLE",
  message: "The AntiDraw server took too long to answer",
};

type RequestOptions = {
  method: string;
  body?: unknown;
  // The caller's cancel; every request is also bounded by `timeoutMs`.
  signal?: AbortSignal;
  timeoutMs?: number;
};

const request = async <T>(
  pathname: string,
  schema: z.ZodType<T>,
  init: RequestOptions,
): Promise<Result<T, CloudError>> => {
  const timeout = AbortSignal.timeout(
    init.timeoutMs ?? cloudTiming.requestTimeoutMs,
  );
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const stopped = (): CloudError | null =>
    init.signal?.aborted ? CANCELLED : timeout.aborted ? TIMED_OUT : null;

  const response = await untilAborted(
    cloudFetch(pathname, {
      method: init.method,
      headers: { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal,
    }),
    signal,
  );
  if (response === ABORTED) return err(stopped() ?? TIMED_OUT);
  if (response.isErr()) {
    // cloudFetch reports an aborted fetch as unreachable; say which it was.
    const reason = stopped();
    if (reason) return err(reason);
    const { status, code, message } = response.error;
    return err({ status, code, message });
  }

  const res = response.value;
  let body: unknown;
  try {
    const read = await untilAborted(res.json() as Promise<unknown>, signal);
    if (read === ABORTED) return err(stopped() ?? TIMED_OUT);
    body = read;
  } catch {
    const reason = stopped();
    if (reason) return err(reason);
    // A body that dies mid-read is as good as no answer; the status is all
    // there is to go on.
    if (!res.ok) {
      return err({
        status: res.status,
        code: "SERVER_ERROR",
        message: `The server answered ${res.status}`,
      });
    }
    return err(malformed(res.status));
  }

  if (!res.ok) {
    const envelope = errorEnvelope.safeParse(body);
    if (!envelope.success) {
      return err({
        status: res.status,
        code: "SERVER_ERROR",
        message: `The server answered ${res.status}`,
      });
    }
    const { code, message, details } = envelope.data.error;
    return err({
      status: res.status,
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return err(malformed(res.status));
  return ok(parsed.data);
};

const sessionPath = (publishId: string) =>
  `/api/publish/sessions/${encodeURIComponent(publishId)}`;

// Cancellable: nothing has been uploaded yet, so a cancel need not wait for
// the answer (a session begun meanwhile just expires).
export const beginPublish = (
  body: BeginPublishRequest,
  opts: { signal?: AbortSignal } = {},
) =>
  request("/api/publish/sessions", beginPublishResponse, {
    method: "POST",
    body,
    ...opts,
  });

// Not cancellable (the server may be committing), only time-limited, by how
// many distinct objects the publish has (`objects`, see completeTimeoutFor).
// It carries nothing: every file, entry pages included, was uploaded, and the
// server switches the site over by writing one pointer after the commit.
export const completePublish = (publishId: string, objects?: number) =>
  request(`${sessionPath(publishId)}/complete`, completePublishResponse, {
    method: "POST",
    body: {},
    timeoutMs: completeTimeoutFor(objects),
  });

export const getPublishSession = (publishId: string) =>
  request(sessionPath(publishId), publishSessionResponse, { method: "GET" });

export const abortPublish = async (
  publishId: string,
): Promise<Result<void, CloudError>> =>
  (
    await request(`${sessionPath(publishId)}/abort`, abortResponse, {
      method: "POST",
      body: {},
    })
  ).map(() => undefined);

export const fetchSiteStatus = async (clientWorkspaceId: string) =>
  (
    await request(
      `/api/publish/sites?${new URLSearchParams({ clientWorkspaceId })}`,
      siteStatusResponse,
      { method: "GET" },
    )
  ).map(({ site }) => site);

export const patchSite = async (
  siteId: string,
  body: { allowRemix: boolean },
) =>
  (
    await request(
      `/api/publish/sites/${encodeURIComponent(siteId)}`,
      patchSiteResponse,
      { method: "PATCH", body },
    )
  ).map(({ site }) => site);
