import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationWithMessages, EffortLevel } from "@/main/api";
import { setPreference } from "@/renderer/lib/api";
import { usePreference } from "@/renderer/lib/preference-ops";
import { queryKeys } from "@/renderer/lib/query-keys";
import {
  DEFAULT_MODELS,
  matchesModel,
  type ModelInfo,
} from "@/renderer/components/modelPickerShared";
import { clampEffort, EFFORT_ORDER } from "@/renderer/components/effortShared";

// Global last-used defaults, updated on every pick (last-used-wins). The
// per-conversation record is the conversation row's selected* columns —
// written only by the send (the options snapshot rides the message).
const MODEL_PREF_KEY = "composer.model";
const EFFORT_PREF_KEY = "composer.effort";

const isEffortLevel = (value: string): value is EffortLevel =>
  (EFFORT_ORDER as string[]).includes(value);

type Picks = { model?: string; effort?: EffortLevel };

/**
 * Composer model/effort state.
 *
 * Options travel WITH the message: what this hook derives is snapshotted
 * into every send (`selectedModelId` / `effort`), which is the only way
 * options are ever set server-side. Display fallback chain, per field:
 *
 *   un-sent pick (local state) > conversation row (last send's snapshot)
 *   > global preference (last-used, any conversation)
 *
 * Un-sent picks are deliberately ephemeral — they exist only until a send
 * snapshots them onto the row, and switching conversations discards them.
 * A pick means "use this for my next send here", nothing more.
 */
export const useComposerModel = (
  conversationId: string | null,
  conversation: ConversationWithMessages | undefined
) => {
  const queryClient = useQueryClient();
  const { data: modelPref } = usePreference(MODEL_PREF_KEY);
  const { data: effortPref } = usePreference(EFFORT_PREF_KEY);

  // Un-sent picks for the CURRENT conversation. Keyed so a conversation
  // switch resets them during render — no effect, no stale flash.
  const [pickState, setPickState] = useState<{
    key: string | null;
    picks: Picks;
  }>({ key: conversationId, picks: {} });
  const picks = pickState.key === conversationId ? pickState.picks : {};
  const addPicks = (next: Picks) =>
    setPickState({ key: conversationId, picks: { ...picks, ...next } });

  const prefModel = modelPref ?? undefined;
  const prefEffort =
    effortPref && isEffortLevel(effortPref) ? effortPref : undefined;

  // `conversation?.selected* ?? pref` covers every non-picked case the same
  // way: row loading, no conversation yet, and a row whose last send ran CLI
  // defaults (null) all fall back to the global preference.
  const selectedModelId =
    picks.model ?? conversation?.selectedModel ?? prefModel;
  const effortValue =
    picks.effort ?? conversation?.selectedEffort ?? prefEffort;

  const selectedModel =
    DEFAULT_MODELS.find((m) => matchesModel(m, selectedModelId)) ??
    DEFAULT_MODELS[0];
  const effortLevels = selectedModel?.supportedEffortLevels ?? [];
  const effectiveEffort = clampEffort(effortValue, effortLevels);

  // Global defaults follow the latest pick (last-used-wins). Cancel any
  // in-flight read of the key first: a resolving fetch unconditionally
  // overwrites the cache, so writing without cancelling lets the old DB
  // value clobber the pick for the rest of the session (staleTime Infinity
  // blocks every corrective refetch). The active composer's display doesn't
  // depend on this write — un-sent picks cover it — so the microtask delay
  // is invisible; the persist is best-effort.
  const persistPreference = (key: string, value: string) => {
    const queryKey = queryKeys.preferences.byKey(key);
    void (async () => {
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, value);
      const result = await setPreference(key, value);
      if (result.isErr()) {
        console.error("Failed to persist preference:", result.error.message);
      }
    })();
  };

  const handleModelChange = (value: string, model: ModelInfo) => {
    persistPreference(MODEL_PREF_KEY, value);
    // Switching models can drop the current effort out of range — snap it.
    // Clamp from the RAW value, not effectiveEffort: the desired level must
    // survive a round trip through a model with fewer levels (Haiku has
    // none, so clamping its undefined display value would resurrect the
    // default and clobber the real selection on the way back).
    const clamped = clampEffort(effortValue, model.supportedEffortLevels ?? []);
    const effortChanged = clamped !== undefined && clamped !== effortValue;
    if (effortChanged) persistPreference(EFFORT_PREF_KEY, clamped);
    addPicks({ model: value, ...(effortChanged ? { effort: clamped } : {}) });
  };

  const handleEffortChange = (level: EffortLevel) => {
    persistPreference(EFFORT_PREF_KEY, level);
    addPicks({ effort: level });
  };

  return {
    models: DEFAULT_MODELS,
    selectedModelId,
    effortLevels,
    effort: effectiveEffort,
    handleModelChange,
    handleEffortChange,
  };
};
