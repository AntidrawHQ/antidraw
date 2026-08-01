/**
 * Effort levels mirror the Agent SDK's `EffortLevel`. The UI options for a given
 * model come from that model's `ModelInfo.supportedEffortLevels`; a model with
 * `supportsEffort === false` (e.g. Haiku) has none, so the picker hides.
 */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

// Canonical order, low → max.
export const EFFORT_ORDER: EffortLevel[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export type EffortMeta = {
  label: string;
  short: string;
  description: string;
};

export const EFFORT_META: Record<EffortLevel, EffortMeta> = {
  low: {
    label: "Low",
    short: "Low",
    description: "Minimal thinking, fastest responses",
  },
  medium: { label: "Medium", short: "Med", description: "Moderate thinking" },
  high: {
    label: "High",
    short: "High",
    description: "Deep reasoning (default)",
  },
  xhigh: {
    label: "Extra high",
    short: "xHigh",
    description: "Deeper than high",
  },
  max: { label: "Max", short: "Max", description: "Maximum effort" },
};

export const DEFAULT_EFFORT: EffortLevel = "high";

export const effortRank = (level: EffortLevel): number =>
  EFFORT_ORDER.indexOf(level);

// Keep only supported levels, in canonical order.
export const orderEfforts = (levels: EffortLevel[]): EffortLevel[] =>
  EFFORT_ORDER.filter((l) => levels.includes(l));

/**
 * Snap a desired level into the available set — used when switching models drops
 * the current level (e.g. you were on `max`, the new model tops out at `high`).
 * Picks the closest available level by rank; returns undefined if none support.
 */
export const clampEffort = (
  desired: EffortLevel | undefined,
  levels: EffortLevel[]
): EffortLevel | undefined => {
  const ordered = orderEfforts(levels);
  if (!ordered.length) return undefined;
  if (desired && ordered.includes(desired)) return desired;
  const target = effortRank(desired ?? DEFAULT_EFFORT);
  return [...ordered].sort(
    (a, b) => Math.abs(effortRank(a) - target) - Math.abs(effortRank(b) - target)
  )[0];
};
