// An in-memory R2 bucket for publish tests, with the behaviour the services
// rely on: put checks the body against its sha256 (as R2 does) and records
// checksums.sha256, list pages with a cursor and returns metadata only when
// asked to (`include`), and delete takes a batch of keys. Hooks let a test
// fail a put or a delete, or remove an object behind the server's back.
//
// Services see it through r2ObjectStore() (src/lib/storage.ts), so the
// adapter the Worker uses is the one under test.

import { r2ObjectStore } from "../lib/storage";

type Stored = {
  size: number;
  sha256: string;
  bytes?: Uint8Array;
  contentType?: string;
  cacheControl?: string;
  customMetadata: Record<string, string>;
  uploaded: Date;
};

export type MemoryBucket = R2Bucket & {
  objects: Map<string, Stored>;
  // Keys in the order they were written (put or simulated upload).
  writes: string[];
  // Each delete call's keys.
  deletes: string[][];
  // Return true to make the put of `key` throw (after nothing is stored).
  failPut: (key: string) => boolean;
  // Number of delete calls that should still throw.
  failDeletes: number;
  // Number of list calls (pages) so far.
  lists: number;
  // What a successful presigned PUT leaves behind, without the bytes.
  upload(
    key: string,
    o: {
      size: number;
      sha256: string;
      contentType?: string;
      cacheControl?: string;
      uploaded?: Date;
    },
  ): void;
  keys(prefix?: string): string[];
};

const hexToBuffer = (hex: string) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out.buffer;
};

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (bytes: Uint8Array | string) =>
  toHex(
    await crypto.subtle.digest(
      "SHA-256",
      typeof bytes === "string"
        ? new TextEncoder().encode(bytes)
        : (bytes as Uint8Array<ArrayBuffer>),
    ),
  );

const readAll = async (body: unknown): Promise<Uint8Array> => {
  if (body === null || body === undefined) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return new Uint8Array(await new Response(body as ReadableStream).arrayBuffer());
};

const asR2Object = (key: string, o: Stored, include: boolean) =>
  ({
    key,
    size: o.size,
    etag: o.sha256.slice(0, 32),
    httpEtag: `"${o.sha256.slice(0, 32)}"`,
    version: "1",
    uploaded: o.uploaded,
    storageClass: "Standard",
    checksums: { sha256: hexToBuffer(o.sha256), toJSON: () => ({ sha256: o.sha256 }) },
    ...(include
      ? {
          httpMetadata: {
            ...(o.contentType ? { contentType: o.contentType } : {}),
            ...(o.cacheControl ? { cacheControl: o.cacheControl } : {}),
          },
          customMetadata: o.customMetadata,
        }
      : {}),
    writeHttpMetadata() {},
  }) as unknown as R2Object;

export const memoryBucket = (opts: { pageSize?: number } = {}): MemoryBucket => {
  const objects = new Map<string, Stored>();
  const writes: string[] = [];
  const deletes: string[][] = [];

  const bucket = {
    objects,
    writes,
    deletes,
    failPut: (_key: string) => false,
    failDeletes: 0,
    lists: 0,

    upload(
      key: string,
      o: {
        size: number;
        sha256: string;
        contentType?: string;
        cacheControl?: string;
        uploaded?: Date;
      },
    ) {
      objects.set(key, {
        size: o.size,
        sha256: o.sha256,
        contentType: o.contentType,
        cacheControl: o.cacheControl,
        customMetadata: { sha256: o.sha256 },
        uploaded: o.uploaded ?? new Date(),
      });
      writes.push(key);
    },

    keys(prefix = "") {
      return [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    },

    async head(key: string) {
      const o = objects.get(key);
      return o ? asR2Object(key, o, true) : null;
    },

    async get(key: string) {
      const o = objects.get(key);
      if (!o) return null;
      const bytes = o.bytes ?? new Uint8Array(o.size);
      return Object.assign(asR2Object(key, o, true), {
        body: new Response(bytes as Uint8Array<ArrayBuffer>).body!,
      });
    },

    async put(key: string, value: unknown, options: R2PutOptions = {}) {
      if (bucket.failPut(key)) throw new Error(`put ${key} failed (test)`);
      const bytes = await readAll(value);
      const sha256 = await sha256Hex(bytes);
      if (typeof options.sha256 === "string" && options.sha256 !== sha256) {
        throw new Error(`put ${key}: the SHA-256 checksum you specified did not match`);
      }
      const http = (options.httpMetadata ?? {}) as R2HTTPMetadata;
      objects.set(key, {
        size: bytes.length,
        sha256,
        bytes,
        contentType: http.contentType,
        cacheControl: http.cacheControl,
        customMetadata: options.customMetadata ?? {},
        uploaded: new Date(),
      });
      writes.push(key);
      return asR2Object(key, objects.get(key)!, true);
    },

    async delete(keys: string | string[]) {
      const list = Array.isArray(keys) ? keys : [keys];
      if (bucket.failDeletes > 0) {
        bucket.failDeletes--;
        throw new Error("delete failed (test)");
      }
      deletes.push(list);
      for (const key of list) objects.delete(key);
    },

    // The cursor is the last key returned, so a page after keys were deleted
    // (GC deletes as it lists) neither skips nor repeats one, as with R2.
    async list(options: R2ListOptions & { include?: string[] } = {}) {
      bucket.lists++;
      const cursor = options.cursor;
      const all = bucket.keys(options.prefix ?? "").filter((k) => !cursor || k > cursor);
      const limit = Math.min(options.limit ?? 1000, opts.pageSize ?? 1000);
      const page = all.slice(0, limit);
      const include = (options.include?.length ?? 0) > 0;
      return {
        objects: page.map((key) => asR2Object(key, objects.get(key)!, include)),
        delimitedPrefixes: [],
        ...(page.length < all.length
          ? { truncated: true, cursor: page[page.length - 1] }
          : { truncated: false }),
      };
    },
  };
  return bucket as unknown as MemoryBucket;
};

// A bucket and the ObjectStore the services see over it.
export const memoryObjectStore = (opts: { pageSize?: number } = {}) => {
  const bucket = memoryBucket(opts);
  return { bucket, store: r2ObjectStore(bucket) };
};
