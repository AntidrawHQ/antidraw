import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Result } from "neverthrow";
import type { ApiError } from "./errors";

// Maps a neverthrow Result from a service into a Hono JSON Response, keeping
// controllers thin. Await a ResultAsync before passing it in.
//   Err  -> { error: { code, message } } with the error's status
//   Ok   -> the value with `successStatus` (default 200)
export const respond = <T>(
  ctx: Context,
  result: Result<T, ApiError>,
  successStatus: ContentfulStatusCode = 200,
) => {
  if (result.isErr()) {
    const { status, code, message } = result.error;
    return ctx.json({ error: { code, message } }, status);
  }
  return ctx.json(result.value, successStatus);
};
