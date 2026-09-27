export type Limits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxPathBytes: number;
};

const MiB = 1024 * 1024;

// Every file goes through a Worker in a single PUT, and Workers on Free and
// Pro zones reject request bodies over 100 MB, so a file must stay under that.
export const DEFAULT_LIMITS: Limits = {
  maxFiles: 10_000,
  maxFileBytes: 95 * MiB,
  maxTotalBytes: 500 * MiB,
  maxPathBytes: 1024,
};

// Stored plans and pointers were checked against the limits in force when they
// were written. Re-reading them must not break a live site if limits shrink.
export const STORED_LIMITS: Limits = {
  maxFiles: Number.MAX_SAFE_INTEGER,
  maxFileBytes: Number.MAX_SAFE_INTEGER,
  maxTotalBytes: Number.MAX_SAFE_INTEGER,
  maxPathBytes: Number.MAX_SAFE_INTEGER,
};

// A plan body is the manifest JSON: at 10k files with 1 KiB paths it stays
// well under this.
export const MAX_PLAN_BODY_BYTES = 16 * MiB;

export const resolveLimits = (partial?: Partial<Limits>): Limits => ({
  ...DEFAULT_LIMITS,
  ...partial,
});
