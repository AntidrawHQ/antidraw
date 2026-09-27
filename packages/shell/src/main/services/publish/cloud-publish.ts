import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { cloudFetch } from "@/main/services/account.service";

// Typed client for the server's publish API (packages/server, spec §2). The
// schemas mirror packages/server/src/lib/publish.schemas.ts by name; neither
// package imports the other, so a change there must be copied here. Requests
// are built from the local types and not re-validated; responses are parsed,
// and anything that does not parse is a SERVER_ERROR.

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const ENTRY_PATHS = ["preview.html", "canvas.json", "index.html"] as const;

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
  site: {
    files: {
      path: string;
      sha256: string;
      size: number;
      contentType: string;
      immutable: boolean;
    }[];
    entries: { path: (typeof ENTRY_PATHS)[number]; sha256: string; size: number }[];
  };
};

export type CompletePublishRequest = {
  entries: { path: (typeof ENTRY_PATHS)[number]; contentBase64: string }[];
};

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
// and SERVER_UNREACHABLE (502), which come from cloudFetch.
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

const request = async <T>(
  pathname: string,
  schema: z.ZodType<T>,
  init: { method: string; body?: unknown },
): Promise<Result<T, CloudError>> => {
  const response = await cloudFetch(pathname, {
    method: init.method,
    headers: { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (response.isErr()) {
    const { status, code, message } = response.error;
    return err({ status, code, message });
  }

  const res = response.value;
  let body: unknown;
  try {
    body = await res.json();
  } catch {
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

export const beginPublish = (body: BeginPublishRequest) =>
  request("/api/publish/sessions", beginPublishResponse, {
    method: "POST",
    body,
  });

export const completePublish = (
  publishId: string,
  body: CompletePublishRequest,
) =>
  request(`${sessionPath(publishId)}/complete`, completePublishResponse, {
    method: "POST",
    body,
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
