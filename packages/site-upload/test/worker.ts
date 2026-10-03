// A Worker wiring the server half the way a real deployment would, for the
// end-to-end tests. Wrangler's test harness bundles and runs it (see
// startTestWorker in helpers.ts), as a deploy would.
import { handleUpload, SiteServer, SiteStore, type Bucket, type Current, type FileCache } from "../src/server";

type Env = { BUCKET: Bucket };
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type CacheStorage = { default: { match(request: Request): Promise<Response | undefined> } };

let store: SiteStore | undefined;
let server: SiteServer | undefined;
// What a real caller keeps in its database: which publish of each site is
// live, and which was before it. The simplest caller: the latest commit wins.
const records = new Map<string, Current>();
const currentOf = async (site: string): Promise<Current> => records.get(site) ?? { live: null, previous: null };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // One store and server per isolate, as in production, so their caches last.
    store ??= new SiteStore({ bucket: env.BUCKET });
    const url = new URL(request.url);

    // /_upload/<site>/<publishId>/<plan | commit | files/<sha256>>
    const upload = /^\/_upload\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (upload) {
      const [, site, publishId, path] = upload as unknown as [string, string, string, string];
      return handleUpload(store, request, { site, publishId, path }, {
        async commit() {
          const record = await currentOf(site);
          if (record.live === publishId) return { publishId, previous: record.previous, alreadyCommitted: true };
          records.set(site, { live: publishId, previous: record.live });
          return { publishId, previous: record.live, alreadyCommitted: false };
        },
      });
    }

    // /_cleanup/<site>?advanceMs=N runs cleanup as if N ms had passed, since
    // the tests can't wait out the grace period. It keeps the live and
    // previous publishes.
    const cleanup = /^\/_cleanup\/([^/]+)$/.exec(url.pathname);
    if (cleanup) {
      const advanceMs = Number(url.searchParams.get("advanceMs") ?? 0);
      const later = new SiteStore({ bucket: env.BUCKET, now: () => Date.now() + advanceMs });
      const { live, previous } = await currentOf(cleanup[1]!);
      const keep = [live, previous].filter((id): id is string => id !== null);
      return Response.json(await later.cleanup(cleanup[1]!, { keep }));
    }

    // /_cached/<sha256>: whether the file cache holds this file yet.
    const cached = /^\/_cached\/([0-9a-f]{64})$/.exec(url.pathname);
    if (cached) {
      const { caches } = globalThis as unknown as { caches: CacheStorage };
      const hit = await caches.default.match(new Request(`https://site-upload.cache/${cached[1]}`));
      return Response.json({ cached: hit !== undefined });
    }

    // Anything else is a site page; the test names the site in a header
    // because Node's fetch can't set Host.
    const site = request.headers.get("x-site");
    if (!site) return new Response("x-site header required", { status: 400 });
    const { caches } = globalThis as unknown as { caches: { default: FileCache } };
    server ??= new SiteServer({ store, current: currentOf, currentTtlMs: 0, cache: caches.default });
    return server.fetch(request, site, ctx);
  },
};
