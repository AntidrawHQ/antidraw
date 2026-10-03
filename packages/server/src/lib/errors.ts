import type { ContentfulStatusCode } from "hono/utils/http-status";

// The single error shape services fail with. Mirrors the { status, code,
// message } convention used by @antidraw/shell's services so the wire format
// is consistent across both APIs: controllers serialize this to
// `{ error: { code, message } }` with `status` as the HTTP status.
export type ApiError = {
  status: ContentfulStatusCode;
  code: string;
  message: string;
};

export const apiError = (
  status: ContentfulStatusCode,
  code: string,
  message: string,
): ApiError => ({ status, code, message });
