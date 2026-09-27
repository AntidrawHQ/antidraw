import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { err, type Result } from "neverthrow";
import { apiError, type ApiError } from "./errors";

// Maps a neverthrow Result from a service into a Hono JSON Response, keeping
// controllers thin. Await a ResultAsync before passing it in.
//   Err  -> { error: { code, message, details? } } with the error's status
//   Ok   -> the value with `successStatus` (default 200)
export const respond = <T>(
  ctx: Context,
  result: Result<T, ApiError>,
  successStatus: ContentfulStatusCode = 200,
) => {
  if (result.isErr()) {
    const { status, code, message, details } = result.error;
    return ctx.json(
      { error: details === undefined ? { code, message } : { code, message, details } },
      status,
    );
  }
  return ctx.json(result.value, successStatus);
};

// Same envelope without a Result in hand — for the places that sit outside the
// controller -> service flow (notFound/onError fallbacks, validation hooks).
export const respondError = (
  ctx: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: unknown,
) => respond(ctx, err(apiError(status, code, message, details)));
