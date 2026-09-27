import { Hono } from "hono";
import { err } from "neverthrow";
import type { AppEnv, Bindings } from "../lib/env";
import { respond, respondError } from "../lib/respond";
import { isWorkerStorageMode, r2ObjectStore } from "../lib/storage";
import { verifyStorageToken, type BucketName } from "../lib/storage-token";
import { checkSiteDomainConfig } from "../services/publish.service";

// /api/storage/:token — local dev's stand-in for presigned R2 URLs (spec
// §2.9, §4.3). It exists only with STORAGE_MODE="worker" and no S3
// credential at all, so production (which has them) answers 404 here and
// never streams uploads through the Worker. The HMAC token, not a session,
// authorizes each request, exactly like a presigned URL.
//
//   PUT /:token  store the body at the token's key, with its size and sha256
//   GET /:token  the object's bytes, as a download (never rendered here)

export const storageController = new Hono<AppEnv>();

const bucketFor = (env: Bindings, bucket: BucketName) =>
  r2ObjectStore(bucket === "sites" ? env.SITES : env.SOURCES);

storageController.use("*", async (ctx, next) => {
  if (!isWorkerStorageMode(ctx.env)) return respondError(ctx, 404, "NOT_FOUND", "Not found");
  const config = checkSiteDomainConfig(ctx.env);
  if (config.isErr()) return respond(ctx, err(config.error));
  await next();
});

storageController.put("/:token", async (ctx) => {
  const token = await verifyStorageToken(
    ctx.env.BETTER_AUTH_SECRET,
    ctx.req.param("token"),
    new Date(),
  );
  if (token.isErr()) return respond(ctx, err(token.error));
  const { op, b, k, n, h, ct, cc } = token.value;
  if (op !== "put" || n === undefined || !h || !ct) {
    return respondError(ctx, 403, "STORAGE_TOKEN_INVALID", "Invalid storage token");
  }
  if (ctx.req.header("content-length") !== String(n)) {
    return respondError(ctx, 400, "SIZE_MISMATCH", `Content-Length must be ${n}`);
  }
  try {
    // The binding checks the bytes against sha256 and refuses a mismatch.
    await bucketFor(ctx.env, b).put(k, ctx.req.raw.body ?? new Uint8Array(), {
      size: n,
      sha256: h,
      contentType: ct,
      ...(cc ? { cacheControl: cc } : {}),
    });
  } catch (error) {
    console.error(error);
    return respondError(ctx, 400, "CHECKSUM_MISMATCH", "The upload did not match its checksum");
  }
  return ctx.json({ ok: true });
});

storageController.get("/:token", async (ctx) => {
  const token = await verifyStorageToken(
    ctx.env.BETTER_AUTH_SECRET,
    ctx.req.param("token"),
    new Date(),
  );
  if (token.isErr()) return respond(ctx, err(token.error));
  if (token.value.op !== "get") {
    return respondError(ctx, 403, "STORAGE_TOKEN_INVALID", "Invalid storage token");
  }
  const object = await bucketFor(ctx.env, token.value.b).get(token.value.k);
  if (!object) return respondError(ctx, 404, "NOT_FOUND", "Not found");
  // Stored bytes are someone's snapshot: serve them as an opaque download so
  // nothing renders on the auth server's origin.
  return new Response(object.body, {
    headers: {
      "content-length": String(object.size),
      "content-type": "application/octet-stream",
      "content-disposition": "attachment",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
});
