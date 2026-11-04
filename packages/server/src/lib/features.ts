import { createMiddleware } from "hono/factory";
import type { Bindings } from "./env";
import type { AuthedEnv } from "./require-session";
import { respondError } from "./respond";

// Features that launch behind a Flagship flag (the FLAGS binding), so they can
// be turned on for a few users first, and off again for everyone, without a
// deploy. The server is what enforces them: builds already shipped call the
// API directly, whatever their UI shows.
//
//   publish  every /api/sites route. Off unless the flag says otherwise, for
//            the user asking (a rule on userId lets testers in).
export type Feature = "publish";

// The binding answers its default for the failures it knows about (no such
// flag, a value of the wrong type), but anything else, such as Flagship being
// unreachable, can still throw. Either way the caller gets its fallback.
export const flagValue = async (
  flags: Flagship,
  key: string,
  fallback: boolean,
  context?: FlagshipEvaluationContext,
) => {
  try {
    const value = await flags.getBooleanValue(key, fallback, context);
    return typeof value === "boolean" ? value : fallback;
  } catch (error) {
    console.error(`Couldn't evaluate the ${key} flag:`, error);
    return fallback;
  }
};

// Whether the feature is on, for this user when there is one. A feature that
// can't be evaluated is off: an unlaunched feature failing closed is the safe
// way round.
export const isFeatureOn = (env: Pick<Bindings, "FLAGS">, feature: Feature, userId?: string) =>
  flagValue(env.FLAGS, feature, false, userId ? { userId } : undefined);

const refusals: Record<Feature, { code: string; message: string }> = {
  publish: { code: "PUBLISH_DISABLED", message: "Publishing isn't available yet." },
};

// For routes behind requireSession or requireBearer, after it: the flag is
// asked about the signed-in user, and a caller who isn't signed in still gets
// the 401 first, so it learns nothing about the feature.
export const requireFeature = (feature: Feature) =>
  createMiddleware<AuthedEnv>(async (ctx, next) => {
    if (!(await isFeatureOn(ctx.env, feature, ctx.get("user").id))) {
      const { code, message } = refusals[feature];
      return respondError(ctx, 403, code, message);
    }
    await next();
  });
