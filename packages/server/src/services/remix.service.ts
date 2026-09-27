import { err, ok, type ResultAsync } from "neverthrow";
import { apiError, type ApiError } from "../lib/errors";
import { DOWNLOAD_URL_TTL_S } from "../lib/publish-limits";
import type { RemixResponse } from "../lib/publish.schemas";
import { blobKey, sourceKey } from "../lib/storage";
import { run, type PublishDeps } from "./publish.service";

// Remix: hand a signed-in user short-lived download URLs for a site's head
// snapshot (the source archive and each distinct blob), always from the
// owner's keys. The app downloads, verifies and extracts them itself; the
// server never inspects an archive.

export const remixSite = (
  deps: PublishDeps,
  userId: string,
  slug: string,
): ResultAsync<RemixResponse, ApiError> =>
  run(async () => {
    const { success } = await deps.remixLimiter.limit({ key: userId });
    if (!success) {
      return err(apiError(429, "RATE_LIMITED", "Too many remixes. Try again in a minute."));
    }

    const site = await deps.store.findSiteBySlug(slug);
    const head = site && site.headVersion > 0 ? await deps.store.getHeadVersion(site) : null;
    if (!site || !head) return err(apiError(404, "SITE_NOT_FOUND", "Site not found"));
    // Owners may always remix their own site.
    if (!site.allowRemix && site.userId !== userId) {
      return err(
        apiError(403, "REMIX_DISABLED", "The owner has turned off remixing for this canvas"),
      );
    }

    const largeFiles = await deps.store.getLargeFiles(head.id);
    const blobUrls = new Map<string, string>();
    for (const f of largeFiles) {
      if (!blobUrls.has(f.sha256)) {
        blobUrls.set(
          f.sha256,
          await deps.signer.downloadUrl({ bucket: "sources", key: blobKey(site.userId, f.sha256) }),
        );
      }
    }
    const sourceUrl = await deps.signer.downloadUrl({
      bucket: "sources",
      key: sourceKey(site.userId, head.sourceSha256),
    });

    return ok({
      remix: {
        slug: site.slug,
        name: site.name,
        version: head.version,
        publishedAt: new Date(head.createdAt).toISOString(),
        expiresAt: new Date(deps.now().getTime() + DOWNLOAD_URL_TTL_S * 1000).toISOString(),
        source: { sha256: head.sourceSha256, size: head.sourceSize, url: sourceUrl },
        largeFiles: largeFiles.map((f) => ({
          path: f.path,
          sha256: f.sha256,
          size: f.size,
          mode: f.mode as 0o644 | 0o755,
          url: blobUrls.get(f.sha256)!,
        })),
      },
    });
  });
