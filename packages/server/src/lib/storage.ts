import { AwsV4Signer } from "aws4fetch";
import { err, ok, type Result } from "neverthrow";
import type { Bindings } from "./env";
import { apiError, type ApiError } from "./errors";
import { DOWNLOAD_URL_TTL_S, UPLOAD_URL_TTL_S } from "./publish-limits";
import { signStorageToken, type BucketName } from "./storage-token";

export type { BucketName };

// R2 access for publish + remix: a small object-store interface over the
// bindings (so services and tests share one shape), and the URL signer that
// lets clients move bytes to and from R2 without passing them through the
// Worker.
//
//   SITES    antidraw-sites    c/<userId>/<sha256>  a site file's content, per account
//                              m/<slug>.json        a site's pointer (services/site-pointer.ts)
//            public, served by packages/publish-worker through the pointers
//   SOURCES  antidraw-sources  u/<userId>/source/<sha256>.tar.gz, u/<userId>/blob/<sha256>
//            private; clients get 10-minute URLs from /api/remix

export type ObjectInfo = {
  key: string;
  size: number;
  // checksums.sha256 (hex), which R2 computed and verified, else the
  // customMetadata.sha256 every writer sets.
  sha256: string | null;
  contentType?: string;
  etag: string;
  uploaded: Date;
};

// A put that happens only if the object is still the one read (its etag), or
// only if there is none yet.
export type PutCondition = { etagMatches: string } | { absent: true };

export type ObjectStore = {
  head(key: string): Promise<ObjectInfo | null>;
  list(prefix: string): AsyncIterable<ObjectInfo>;
  // R2 rejects bytes whose sha256 differs. False when `onlyIf` failed, and
  // nothing was written.
  put(
    key: string,
    body: ReadableStream | Uint8Array,
    opts: { size: number; sha256: string; contentType: string; onlyIf?: PutCondition },
  ): Promise<boolean>;
  get(
    key: string,
  ): Promise<{ body: ReadableStream; size: number; contentType?: string; etag: string } | null>;
  delete(keys: string[]): Promise<void>;
};

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

const objectInfo = (object: R2Object): ObjectInfo => ({
  key: object.key,
  size: object.size,
  sha256: object.checksums?.sha256
    ? toHex(object.checksums.sha256)
    : (object.customMetadata?.sha256 ?? null),
  contentType: object.httpMetadata?.contentType,
  etag: object.etag,
  uploaded: object.uploaded,
});

// FixedLengthStream is a Workers API: it gives R2 the length a stream body
// must have. Under Node (tests) the body is buffered instead.
const sizedBody = (body: ReadableStream | Uint8Array, size: number) => {
  if (body instanceof Uint8Array || typeof FixedLengthStream !== "function") return body;
  return body.pipeThrough(new FixedLengthStream(size));
};

export const r2ObjectStore = (bucket: R2Bucket): ObjectStore => ({
  async head(key) {
    const object = await bucket.head(key);
    return object ? objectInfo(object) : null;
  },
  async *list(prefix) {
    let cursor: string | undefined;
    do {
      // `include` is honored from compatibility date 2023-07-01; the base
      // workers-types entry point this package compiles against predates it.
      const options: R2ListOptions & { include: ("httpMetadata" | "customMetadata")[] } = {
        prefix,
        cursor,
        include: ["httpMetadata", "customMetadata"],
      };
      const page = await bucket.list(options);
      for (const object of page.objects) yield objectInfo(object);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  },
  async put(key, body, { size, sha256, contentType, onlyIf }) {
    const written = await bucket.put(key, sizedBody(body, size), {
      sha256,
      httpMetadata: { contentType },
      customMetadata: { sha256 },
      // "*" is If-None-Match: *, which R2 (and miniflare) accept: only when
      // there is no object under the key.
      ...(onlyIf
        ? {
            onlyIf:
              "absent" in onlyIf ? { etagDoesNotMatch: "*" } : { etagMatches: onlyIf.etagMatches },
          }
        : {}),
    });
    return written !== null;
  },
  async get(key) {
    const object = await bucket.get(key);
    if (!object) return null;
    return {
      body: object.body,
      size: object.size,
      contentType: object.httpMetadata?.contentType,
      etag: object.etag,
    };
  },
  async delete(keys) {
    if (keys.length > 0) await bucket.delete(keys);
  },
});

export const sourceKey = (userId: string, sha256: string) => `u/${userId}/source/${sha256}.tar.gz`;
export const blobKey = (userId: string, sha256: string) => `u/${userId}/blob/${sha256}`;
// A site file's content, shared by every path, version and site of the
// account that has it.
export const siteContentKey = (userId: string, sha256: string) => `c/${userId}/${sha256}`;
// The live pointer the publish Worker serves the site from.
export const pointerKey = (slug: string) => `m/${slug}.json`;

export const hexToBase64 = (hex: string): string => {
  let binary = "";
  for (let i = 0; i < hex.length; i += 2) {
    binary += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return btoa(binary);
};

export type UploadTarget = {
  bucket: BucketName;
  key: string;
  sha256: string;
  size: number;
  contentType: string;
};

// The client sends exactly `headers` with a PUT of the bytes to `url`
// (duplex: "half"); any 2xx means stored and verified. Identical in both modes.
export type UrlSigner = {
  mode: "s3" | "worker";
  uploadUrl(t: UploadTarget): Promise<{ url: string; headers: Record<string, string> }>;
  downloadUrl(t: { bucket: BucketName; key: string }): Promise<string>;
};

const S3_CREDENTIALS = ["R2_ACCOUNT_ID", "R2_S3_ACCESS_KEY_ID", "R2_S3_SECRET_ACCESS_KEY"] as const;

export const hasAnyS3Credential = (env: Bindings): boolean =>
  S3_CREDENTIALS.some((name) => !!env[name]);

// The dev storage route exists only when explicitly asked for and no S3
// credential is set, so a prod deploy that forgets a secret fails closed
// instead of streaming large uploads through the Worker.
export const isWorkerStorageMode = (env: Bindings): boolean =>
  env.STORAGE_MODE === "worker" && !hasAnyS3Credential(env);

const amzDate = (date: Date) => date.toISOString().replace(/[:-]|\.\d{3}/g, "");

const s3Signer = (
  env: Bindings & Required<Pick<Bindings, (typeof S3_CREDENTIALS)[number]>>,
  now: () => Date,
): UrlSigner => {
  const bucketName = (bucket: BucketName) =>
    bucket === "sites" ? env.SITES_BUCKET_NAME : env.SOURCES_BUCKET_NAME;
  const objectUrl = (bucket: BucketName, key: string, ttlSeconds: number) => {
    const url = new URL(
      `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${bucketName(bucket)}/${key
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
    );
    url.searchParams.set("X-Amz-Expires", String(ttlSeconds));
    return url.toString();
  };
  const sign = (url: string, method: "PUT" | "GET", headers: Record<string, string>) =>
    new AwsV4Signer({
      url,
      method,
      headers,
      accessKeyId: env.R2_S3_ACCESS_KEY_ID,
      secretAccessKey: env.R2_S3_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
      datetime: amzDate(now()),
      // Presigned (the signature goes in the query), over every header, so
      // content-length, the checksum and the metadata are all signed: a client
      // that sends other values, or a body of another size, fails the
      // signature; a different body of the right size fails R2's checksum.
      // The payload hash is UNSIGNED-PAYLOAD, aws4fetch's default for S3.
      signQuery: true,
      allHeaders: true,
    }).sign();

  return {
    mode: "s3",
    async uploadUrl(t) {
      const headers: Record<string, string> = {
        "content-type": t.contentType,
        "content-length": String(t.size),
        // TODO(publish): confirm once against a staging bucket that R2
        // enforces this on a presigned PUT (spec §9 Q1). Complete re-checks
        // size and checksums.sha256 with HEAD either way.
        "x-amz-checksum-sha256": hexToBase64(t.sha256),
        "x-amz-meta-sha256": t.sha256, // lands in customMetadata.sha256
      };
      const signed = await sign(objectUrl(t.bucket, t.key, UPLOAD_URL_TTL_S), "PUT", headers);
      return { url: signed.url.toString(), headers };
    },
    async downloadUrl(t) {
      const signed = await sign(objectUrl(t.bucket, t.key, DOWNLOAD_URL_TTL_S), "GET", {});
      return signed.url.toString();
    },
  };
};

// Dev: bytes go through this Worker's /api/storage/:token route, which writes
// them to the local R2 binding with the sha256 check. The token carries what
// the presigned headers would.
const workerSigner = (env: Bindings, now: () => Date): UrlSigner => {
  const base = `${env.BETTER_AUTH_URL.replace(/\/+$/, "")}/api/storage`;
  return {
    mode: "worker",
    async uploadUrl(t) {
      const token = await signStorageToken(env.BETTER_AUTH_SECRET, {
        v: 1,
        op: "put",
        b: t.bucket,
        k: t.key,
        n: t.size,
        h: t.sha256,
        ct: t.contentType,
        exp: now().getTime() + UPLOAD_URL_TTL_S * 1000,
      });
      return {
        url: `${base}/${token}`,
        headers: {
          "content-type": t.contentType,
          "content-length": String(t.size),
        },
      };
    },
    async downloadUrl(t) {
      const token = await signStorageToken(env.BETTER_AUTH_SECRET, {
        v: 1,
        op: "get",
        b: t.bucket,
        k: t.key,
        exp: now().getTime() + DOWNLOAD_URL_TTL_S * 1000,
      });
      return `${base}/${token}`;
    },
  };
};

// All three S3 credentials: presigned R2 URLs (STORAGE_MODE is ignored). None,
// with STORAGE_MODE="worker": the dev route. Anything else is a broken deploy.
export const makeUrlSigner = (env: Bindings, now: () => Date): Result<UrlSigner, ApiError> => {
  const { R2_ACCOUNT_ID, R2_S3_ACCESS_KEY_ID, R2_S3_SECRET_ACCESS_KEY } = env;
  if (R2_ACCOUNT_ID && R2_S3_ACCESS_KEY_ID && R2_S3_SECRET_ACCESS_KEY) {
    return ok(
      s3Signer({ ...env, R2_ACCOUNT_ID, R2_S3_ACCESS_KEY_ID, R2_S3_SECRET_ACCESS_KEY }, now),
    );
  }
  if (isWorkerStorageMode(env)) return ok(workerSigner(env, now));
  return err(apiError(500, "STORAGE_MISCONFIGURED", "Storage is not configured on this server"));
};
