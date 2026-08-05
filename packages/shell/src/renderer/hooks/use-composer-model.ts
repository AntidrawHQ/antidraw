import { useMutationState, useQueryClient } from "@tanstack/react-query";
import type { ConversationWithMessages, EffortLevel } from "@/main/api";
import { setPreference } from "@/renderer/lib/api";
import { usePreference } from "@/renderer/lib/preference-ops";
import {
  conversationOptionsMutationKey,
  useConversationOptions,
  useUpdateConversationOptions,
} from "@/renderer/lib/claude-code-ops";
import { queryKeys } from "@/renderer/lib/query-keys";
import {
  DEFAULT_MODELS,
  matchesModel,
  type ModelInfo,
} from "@/renderer/components/modelPickerShared";
import { clampEffort, EFFORT_ORDER } from "@/renderer/components/effortShared";

// Global defaults for NEW conversations. Per-conversation requested state
// lives on the conversation row (selectedModel/selectedEffort), read here
// via the options query.
const MODEL_PREF_KEY = "composer.model";
const EFFORT_PREF_KEY = "composer.effort";

const isEffortLevel = (value: string): value is EffortLevel =>
  (EFFORT_ORDER as string[]).includes(value);

// Timestamps cross the JSON boundary as ISO strings even where types say
// Date; normalize either to epoch millis. Absent → 0, so any echo beats a
// never-requested row.
const toMillis = (value: Date | string | null | undefined): number =>
  value ? new Date(value).getTime() : 0;

/**
 * The newest model echo from the CLI, scanning the transcript backwards.
 * Priority is positional (latest wins), across the three signals the CLI
 * emits: `model_refusal_fallback` (the CLI swapped models on its own),
 * main-thread assistant messages (the model that actually produced the
 * response — subagent messages carry parent_tool_use_id and are skipped),
 * and `init` (re-emitted at the start of every turn). Carries the message
 * row's createdAt for requested-vs-actual arbitration.
 */
const findModelEcho = (conversation: ConversationWithMessages | undefined) => {
  const msgs = conversation?.messages;
  if (!msgs?.length) return undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const sdk = msgs[i].sdkMessage;
    const at = toMillis(msgs[i].createdAt);
    if (sdk.type === "system" && sdk.subtype === "model_refusal_fallback") {
      return { model: sdk.fallback_model, at };
    }
    if (sdk.type === "assistant" && sdk.parent_tool_use_id === null) {
      return { model: sdk.message.model, at };
    }
    if (sdk.type === "system" && sdk.subtype === "init") {
      return { model: sdk.model, at };
    }
  }
  return undefined;
};

/**
 * Composer model/effort state — one-way data flow, no local state.
 *
 * Everything the picker shows is DERIVED at render time from three queries
 * and the pending mutation queue; there is nothing to seed, fold, or guard
 * against going stale:
 *
 * - REQUESTED: the options query (row intent) — or the global preference
 *   queries when no conversation exists yet / the row field is null at
 *   composer level (new conversations only; a null field on an existing
 *   row means "CLI defaults" and displays as the Default catalog entry).
 * - ACTUAL: the transcript's model echo (findModelEcho) and the durable
 *   Stop-hook effort echo returned by the options query.
 * - ARBITRATION: while an options mutation is pending for a field, the
 *   pending value wins unconditionally (optimistic display via mutation
 *   variables — the cache never holds optimistic state, so refetches can't
 *   clobber it). At rest, the newer of request vs. echo wins by timestamp.
 *   Known transient: an echo from a turn that STARTED before a pick can
 *   outtimestamp the pick and show for one turn; the next turn converges.
 */
export const useComposerModel = (
  conversationId: string | null,
  conversation: ConversationWithMessages | undefined
) => {
  const queryClient = useQueryClient();
  const { data: row } = useConversationOptions(conversationId);
  const { data: modelPref } = usePreference(MODEL_PREF_KEY);
  const { data: effortPref } = usePreference(EFFORT_PREF_KEY);
  const updateOptions = useUpdateConversationOptions(conversationId);

  // Pending mutation variables, oldest → newest (scope-queued picks
  // included). Reduced per field so an effort-only pick doesn't put the
  // model into "pending wins" mode and vice versa.
  const pendingVariables = useMutationState({
    filters: {
      mutationKey: conversationId
        ? conversationOptionsMutationKey(conversationId)
        : ["conversation-options", "none"],
      status: "pending",
    },
    select: (mutation) =>
      mutation.state.variables as { model?: string; effort?: EffortLevel },
  });
  let pendingModel: string | undefined;
  let pendingEffort: EffortLevel | undefined;
  for (const vars of pendingVariables) {
    if (vars?.model !== undefined) pendingModel = vars.model;
    if (vars?.effort !== undefined) pendingEffort = vars.effort;
  }

  // REQUESTED, per field: pending pick > row intent > global preference
  // (prefs apply only before a row exists — they seed new conversations).
  const prefModel = modelPref ?? undefined;
  const prefEffort =
    effortPref && isEffortLevel(effortPref) ? effortPref : undefined;
  const requestedModel =
    pendingModel ?? (row ? (row.selectedModel ?? undefined) : prefModel);
  const requestedEffort =
    pendingEffort ?? (row ? (row.selectedEffort ?? undefined) : prefEffort);
  const requestedAt = toMillis(row?.optionsUpdatedAt);

  // ACTUAL vs REQUESTED. An echo for a model outside the catalog can't be
  // represented in the picker — requested keeps the slot.
  const echo = findModelEcho(conversation);
  const echoRow = echo
    ? DEFAULT_MODELS.find((m) => matchesModel(m, echo.model))
    : undefined;
  const displayedModelId =
    pendingModel === undefined && echo && echoRow && echo.at > requestedAt
      ? echoRow.value
      : requestedModel;

  const actualEffortAt = toMillis(row?.actualEffortAt);
  const displayedEffort =
    pendingEffort === undefined &&
    row?.actualEffort &&
    actualEffortAt > requestedAt
      ? row.actualEffort
      : requestedEffort;

  const selectedModel =
    DEFAULT_MODELS.find((m) => matchesModel(m, displayedModelId)) ??
    DEFAULT_MODELS[0];
  const effortLevels = selectedModel?.supportedEffortLevels ?? [];
  const effectiveEffort = clampEffort(displayedEffort, effortLevels);

  // Global defaults follow the latest pick (last-used-wins). The cache is
  // updated synchronously so prefs-derived display reflects the click
  // immediately; the persist is best-effort.
  const persistPreference = (key: string, value: string) => {
    queryClient.setQueryData(queryKeys.preferences.byKey(key), value);
    void setPreference(key, value).then((result) => {
      if (result.isErr()) {
        console.error("Failed to persist preference:", result.error.message);
      }
    });
  };

  const handleModelChange = (value: string, model: ModelInfo) => {
    persistPreference(MODEL_PREF_KEY, value);
    // Switching models can drop the current effort out of range — snap it.
    const clamped = clampEffort(
      displayedEffort,
      model.supportedEffortLevels ?? []
    );
    const effortChanged = clamped !== undefined && clamped !== displayedEffort;
    if (effortChanged) persistPreference(EFFORT_PREF_KEY, clamped);
    if (conversationId) {
      updateOptions.mutate({
        model: value,
        ...(effortChanged ? { effort: clamped } : {}),
      });
    }
  };

  const handleEffortChange = (level: EffortLevel) => {
    persistPreference(EFFORT_PREF_KEY, level);
    if (conversationId) {
      updateOptions.mutate({ effort: level });
    }
  };

  return {
    models: DEFAULT_MODELS,
    selectedModelId: displayedModelId,
    effortLevels,
    effort: effectiveEffort,
    handleModelChange,
    handleEffortChange,
  };
};
