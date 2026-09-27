// The slice of R2Bucket the store uses. An R2 binding satisfies it as is; it's
// declared here so the library doesn't pull Workers types into its consumers.

export type BucketObject = { key: string; size: number; etag: string; uploaded: Date };

export type BucketObjectBody = BucketObject & {
  body: ReadableStream;
  text(): Promise<string>;
};

export type BucketRange = { offset: number; length: number };

export type BucketPutValue = ReadableStream | ArrayBuffer | ArrayBufferView | string | null;

export type BucketPutOptions = {
  sha256?: string;
  onlyIf?: { etagMatches?: string };
  httpMetadata?: { contentType?: string };
};

export interface Bucket {
  get(
    key: string,
    options?: { range?: BucketRange },
  ): Promise<BucketObject | BucketObjectBody | null>;
  put(
    key: string,
    value: BucketPutValue,
    options?: BucketPutOptions,
  ): Promise<BucketObject | null>;
  list(options: {
    prefix: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ objects: BucketObject[]; truncated: boolean; cursor?: string }>;
  delete(keys: string | string[]): Promise<void>;
}

// R2 returns an object without a body when a conditional get fails. Checking
// for text() rather than reading `body` leaves the stream untouched.
export const hasBody = (object: BucketObject | BucketObjectBody | null): object is BucketObjectBody =>
  object !== null && typeof (object as Partial<BucketObjectBody>).text === "function";

export async function* listAll(bucket: Bucket, prefix: string): AsyncGenerator<BucketObject> {
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    yield* page.objects;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

// R2 deletes at most 1000 keys per call.
export async function deleteAll(bucket: Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }
}
