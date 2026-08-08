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
 *
 * Snaps DOWN: the highest supported level at or below the desired one — a
 * model that supports a level supports the ones below it, so moving down
 * always lands on something sensible and never silently spends more than
 * the user asked for. The two edge branches:
 * - nothing supported at or below the desired level (only possible with a
 *   gap-free set starting above it): the lowest supported level;
 * - no supported levels at all (e.g. Haiku): undefined — effort is not
 *   applicable, the dropdown hides, and sends omit effort (which preserves
 *   the row's remembered value).
 */
export const clampEffort = (
  desired: EffortLevel | undefined,
  levels: EffortLevel[]
): EffortLevel | undefined => {
  const ordered = orderEfforts(levels);
  if (!ordered.length) return undefined;
  if (desired && ordered.includes(desired)) return desired;
  const target = effortRank(desired ?? DEFAULT_EFFORT);
  const atOrBelow = [...ordered]
    .reverse()
    .find((level) => effortRank(level) <= target);
  return atOrBelow ?? ordered[0];
};
