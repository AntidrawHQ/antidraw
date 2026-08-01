/**
 * Mirrors `ModelInfo` from `@anthropic-ai/claude-agent-sdk` — the shape returned
 * by `query.supportedModels()`. Duplicated here so the picker stays decoupled
 * from the SDK for now; swap for a direct import once model switching lands.
 */
export type ModelInfo = {
  /** Model identifier to use in API calls. */
  value: string;
  /** Canonical wire id an alias resolves to (e.g. 'sonnet' → 'claude-sonnet-5'). */
  resolvedModel?: string;
  /** Human-readable display name. */
  displayName: string;
  /** Description of the model's capabilities. */
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: EffortLevel[];
  supportsAdaptiveThinking?: boolean;
  supportsFastMode?: boolean;
  supportsAutoMode?: boolean;
};

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

// A persisted explicit id (e.g. "claude-sonnet-5") should still light up the
// alias row ("sonnet") whose resolvedModel covers it.
export const matchesModel = (model: ModelInfo, id: string | undefined) =>
  id !== undefined && (model.value === id || model.resolvedModel === id);

/**
 * The real catalog returned by `query.supportedModels()` (Agent SDK v0.3.201),
 * captured live so the examples read authentically.
 *
 * TODO: replace this hardcoded list with an actual `await query.supportedModels()`
 * call against `@anthropic-ai/claude-agent-sdk` once real model switching lands.
 */
export const DEFAULT_MODELS: ModelInfo[] = [
  {
    value: "default",
    resolvedModel: "claude-opus-4-8[1m]",
    displayName: "Default (recommended)",
    description: "Opus 4.8 with 1M context · Best for everyday, complex tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    value: "opus[1m]",
    resolvedModel: "claude-opus-4-8[1m]",
    displayName: "Opus",
    description: "Opus 4.8 with 1M context · Best for everyday, complex tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    value: "claude-fable-5[1m]",
    resolvedModel: "claude-fable-5",
    displayName: "Fable",
    description:
      "Fable 5 · Most capable for your hardest and longest-running tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
  {
    value: "sonnet",
    resolvedModel: "claude-sonnet-5",
    displayName: "Sonnet",
    description: "Sonnet 5 · Efficient for routine tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
    supportsAutoMode: true,
  },
  {
    value: "haiku",
    resolvedModel: "claude-haiku-4-5-20251001",
    displayName: "Haiku",
    description: "Haiku 4.5 · Fastest for quick answers",
  },
];
