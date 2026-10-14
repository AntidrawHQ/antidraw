// The parts of the Artifacts binding (git repos on Cloudflare) this Worker
// uses, as the binding behaves today. @cloudflare/workers-types 4.x still has
// an older shape (no readCommit, a repo's info as properties), and tests
// bind a stub Worker with these methods instead (src/test/artifacts-stub).
// https://developers.cloudflare.com/artifacts/api/workers-binding/

export type ArtifactsRepo = {
  info(): Promise<{ name: string; remote: string; defaultBranch: string }>;
  /** ttl in seconds, 60 to 31536000. plaintext is `<secret>?expires=<unix seconds>`. */
  createToken(scope: "read" | "write", ttl: number): Promise<{ plaintext: string; expiresAt: string }>;
  /** null when the repo has no such commit. */
  readCommit(hash: string): Promise<{ hash: string } | null>;
};

export type Artifacts = {
  /** Throws ALREADY_EXISTS if the name is taken. */
  create(name: string, opts?: { setDefaultBranch?: string }): Promise<{ name: string; remote: string }>;
  /**
   * Throws NOT_FOUND if there's no such repo. The handle is released when the
   * request ends; Cloudflare suggests `using` to release it sooner, which
   * these short requests don't need.
   */
  get(name: string): Promise<ArtifactsRepo>;
};

// The binding's errors carry a `code` in production, but lose it on the way
// through wrangler dev's proxy to the real service (and through RPC from the
// test stub), so the message is checked too.
const messages = { ALREADY_EXISTS: /already exists/i, NOT_FOUND: /not found/i };

export const isArtifactsError = (error: unknown, code: keyof typeof messages) =>
  error instanceof Error &&
  ((error as Error & { code?: string }).code === code || messages[code].test(error.message));
