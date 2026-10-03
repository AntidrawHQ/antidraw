export type Limits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxPathBytes: number;
  /**
   * The file list's JSON size (paths plus entries). Bounds what a manifest
   * costs to store, read and parse on every serving isolate.
   */
  maxManifestBytes: number;
};

const MiB = 1024 * 1024;

// Every file goes through a Worker in a single PUT, and Workers on Free and
// Pro zones reject request bodies over 100 MB, so a file must stay under that.
export const DEFAULT_LIMITS: Limits = {
  maxFiles: 10_000,
  maxFileBytes: 95 * MiB,
  maxTotalBytes: 500 * MiB,
  maxPathBytes: 1024,
  // About 200 bytes a file at the file limit.
  maxManifestBytes: 2 * MiB,
};

// Stored manifests were checked against the limits in force when they
// were written. Re-reading them must not break a live site if limits shrink.
export const STORED_LIMITS: Limits = {
  maxFiles: Number.MAX_SAFE_INTEGER,
  maxFileBytes: Number.MAX_SAFE_INTEGER,
  maxTotalBytes: Number.MAX_SAFE_INTEGER,
  maxPathBytes: Number.MAX_SAFE_INTEGER,
  maxManifestBytes: Number.MAX_SAFE_INTEGER,
};

// A plan body is the manifest JSON: at 10k files with 1 KiB paths it stays
// well under this.
export const MAX_PLAN_BODY_BYTES = 16 * MiB;

/**
 * Fills in defaults. An explicit `undefined` keeps the default instead of
 * switching the limit off; anything but a positive safe integer is refused.
 */
export function resolveLimits(partial?: Partial<Limits>): Limits {
  const limits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as (keyof Limits)[]) {
    const value = partial?.[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(`Limit ${key} must be a positive integer, got ${typeof value === "string" ? JSON.stringify(value) : String(value)}`);
    }
    limits[key] = value;
  }
  return limits;
}
