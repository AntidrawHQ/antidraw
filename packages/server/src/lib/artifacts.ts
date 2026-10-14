// The Artifacts binding (git repos on Cloudflare) is typed by
// @cloudflare/workers-types: Artifacts, ArtifactsRepo, ArtifactsError.
// https://developers.cloudflare.com/artifacts/api/workers-binding/

// The binding's errors carry a `code` in production, but lose it on the way
// through wrangler dev's proxy to the real service (and through RPC from the
// test stub), so the message is checked too.
const messages = { ALREADY_EXISTS: /already exists/i, NOT_FOUND: /not found/i };

export const isArtifactsError = (error: unknown, code: keyof typeof messages) =>
  error instanceof Error &&
  ((error as Error & { code?: string }).code === code || messages[code].test(error.message));
