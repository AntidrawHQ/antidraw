export type ErrorCode =
  // Request and manifest validation
  | "INVALID_REQUEST"
  | "INVALID_MANIFEST"
  | "TOO_LARGE"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  // File uploads
  | "LENGTH_REQUIRED"
  | "NOT_IN_PLAN"
  | "SIZE_MISMATCH"
  | "HASH_MISMATCH"
  // Plans and commits
  | "NO_PLAN"
  | "PLAN_EXISTS"
  | "PLAN_EXPIRED"
  | "MISSING_FILES"
  | "CONFLICT"
  | "SUPERSEDED"
  // Client side only
  | "UNSUPPORTED_FILE"
  | "FILE_CHANGED"
  | "NETWORK"
  // An HTTP error without this API's error body (a gateway or proxy page)
  | "HTTP_ERROR"
  | "BAD_RESPONSE"
  | "INTERNAL";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_MANIFEST: 400,
  TOO_LARGE: 413,
  METHOD_NOT_ALLOWED: 405,
  NOT_FOUND: 404,
  LENGTH_REQUIRED: 411,
  NOT_IN_PLAN: 409,
  SIZE_MISMATCH: 400,
  HASH_MISMATCH: 400,
  NO_PLAN: 404,
  PLAN_EXISTS: 409,
  PLAN_EXPIRED: 410,
  MISSING_FILES: 409,
  CONFLICT: 409,
  SUPERSEDED: 409,
  UNSUPPORTED_FILE: 400,
  FILE_CHANGED: 400,
  NETWORK: 502,
  HTTP_ERROR: 502,
  BAD_RESPONSE: 502,
  INTERNAL: 500,
};

export type ErrorBody = {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
};

export type RetryInfo = {
  status?: number;
  retryable?: boolean;
  // The server is overloaded: the client drops to one upload at a time.
  throttle?: boolean;
  retryAfterMs?: number;
};

export class SiteUploadError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;
  readonly status?: number;
  readonly retryable: boolean;
  readonly throttle: boolean;
  readonly retryAfterMs?: number;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    retry: RetryInfo = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SiteUploadError";
    this.code = code;
    this.details = details;
    this.status = retry.status;
    this.retryable = retry.retryable ?? false;
    this.throttle = retry.throttle ?? false;
    this.retryAfterMs = retry.retryAfterMs;
  }
}
