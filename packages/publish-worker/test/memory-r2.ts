// An in-memory stand-in for the parts of R2Bucket the Worker uses: get (with
// onlyIf.etagDoesNotMatch and a range) and put. Every get is logged by key,
// and `fail` makes the next reads throw, as an unavailable R2 would.

type Stored = { bytes: Uint8Array; etag: string; uploaded: Date };

const bodyOf = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

export const createMemoryR2 = () => {
  const objects = new Map<string, Stored>();
  const reads: string[] = [];
  let etags = 0;
  let failing: ((key: string) => boolean) | null = null;

  const object = (key: string, stored: Stored) => ({
    key,
    size: stored.bytes.length,
    etag: stored.etag,
    httpEtag: `"${stored.etag}"`,
    uploaded: stored.uploaded,
  });

  const bucket = {
    async get(
      key: string,
      options?: {
        onlyIf?: { etagDoesNotMatch?: string };
        range?: { offset: number; length: number };
      },
    ) {
      reads.push(key);
      if (failing?.(key)) throw new Error("R2 is unavailable");
      const stored = objects.get(key);
      if (!stored) return null;
      if (options?.onlyIf?.etagDoesNotMatch === stored.etag) return object(key, stored);
      const bytes = options?.range
        ? stored.bytes.slice(options.range.offset, options.range.offset + options.range.length)
        : stored.bytes;
      return {
        ...object(key, stored),
        body: bodyOf(bytes),
        text: async () => new TextDecoder().decode(bytes),
      };
    },
    async head(key: string) {
      throw new Error(`the Worker reads by get only (head ${key})`);
    },
  };

  return {
    bucket: bucket as unknown as R2Bucket,
    reads,
    put(key: string, value: string | Uint8Array, uploaded = new Date()) {
      const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
      objects.set(key, { bytes, etag: `etag-${++etags}`, uploaded });
    },
    delete(key: string) {
      objects.delete(key);
    },
    fail(when: ((key: string) => boolean) | null) {
      failing = when;
    },
  };
};

export type MemoryR2 = ReturnType<typeof createMemoryR2>;
