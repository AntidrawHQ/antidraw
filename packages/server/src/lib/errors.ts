import type { ContentfulStatusCode } from "hono/utils/http-status";

// The single error shape services fail with. Mirrors the { status, code,
// message } convention used by @antidraw/shell's services so the wire format
// is consistent across both APIs: controllers serialize this to
// `{ error: { code, message, details? } }` with `status` as the HTTP status.
// `details` is optional machine-readable context (limits, offending paths),
// and is left off the wire when it is undefined.
export type ApiError = {
  status: ContentfulStatusCode;
  code: string;
  message: string;
  details?: unknown;
};

export const apiError = (
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: unknown,
): ApiError =>
  details === undefined ? { status, code, message } : { status, code, message, details };
