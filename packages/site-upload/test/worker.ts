// A Worker wiring the server half the way a real deployment would, for the
// end-to-end tests. Bundled with esbuild for a neutral platform, so any Node
// import in src/server fails the bundle.
import { handleUpload, SiteServer, SiteStore, type Bucket, type FileCache } from "../src/server";

type Env = { BUCKET: Bucket };
type ExecutionContext = { waitUntil(promise: Promise<unknown>): void };
type CacheStorage = { default: { match(request: Request): Promise<Response | undefined> } };

let store: SiteStore | undefined;
let server: SiteServer | undefined;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // One store and server per isolate, as in production, so their caches last.
    store ??= new SiteStore({ bucket: env.BUCKET });
    const url = new URL(request.url);

    // /_upload/<site>/<publishId>/<plan | commit | files/<sha256>>
    const upload = /^\/_upload\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (upload) {
      return handleUpload(store, request, { site: upload[1]!, publishId: upload[2]!, path: upload[3]! });
    }

    // /_cleanup/<site>?advanceMs=N runs cleanup as if N ms had passed, since
    // the tests can't wait out the grace period.
    const cleanup = /^\/_cleanup\/([^/]+)$/.exec(url.pathname);
    if (cleanup) {
      const advanceMs = Number(url.searchParams.get("advanceMs") ?? 0);
      const later = new SiteStore({ bucket: env.BUCKET, now: () => Date.now() + advanceMs });
      return Response.json(await later.cleanup(cleanup[1]!));
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
    server ??= new SiteServer({ store, pointerTtlMs: 0, cache: caches.default });
    return server.fetch(request, site, ctx);
  },
};
