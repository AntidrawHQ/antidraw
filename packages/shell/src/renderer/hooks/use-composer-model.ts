import { useEffect, useRef, useState } from "react";
import type { ConversationWithMessages, EffortLevel } from "@/main/api";
import {
  getPreference,
  setPreference,
  updateConversationOptions,
} from "@/renderer/lib/api";
import { useActualEffort } from "@/renderer/lib/claude-code-ops";
import {
  DEFAULT_MODELS,
  matchesModel,
  type ModelInfo,
} from "@/renderer/components/modelPickerShared";
import { clampEffort, EFFORT_ORDER } from "@/renderer/components/effortShared";

// Global defaults for NEW conversations. Per-conversation requested state
// lives on the conversation row (selectedModel/selectedEffort).
const MODEL_PREF_KEY = "composer.model";
const EFFORT_PREF_KEY = "composer.effort";

const isEffortLevel = (value: string): value is EffortLevel =>
  (EFFORT_ORDER as string[]).includes(value);

/**
 * The newest model echo from the CLI, scanning the transcript backwards.
 * Priority is positional (latest wins), across the three signals the CLI
 * emits: `model_refusal_fallback` (the CLI swapped models on its own),
 * main-thread assistant messages (the model that actually produced the
 * response — subagent messages carry parent_tool_use_id and are skipped),
 * and `init` (re-emitted at the start of every turn).
 */
const findModelEcho = (conversation: ConversationWithMessages | undefined) => {
  const msgs = conversation?.messages;
  if (!msgs?.length) return undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const sdk = msgs[i].sdkMessage;
    if (sdk.type === "system" && sdk.subtype === "model_refusal_fallback") {
      return { model: sdk.fallback_model, uuid: sdk.uuid };
    }
    if (sdk.type === "assistant" && sdk.parent_tool_use_id === null) {
      return { model: sdk.message.model, uuid: sdk.uuid };
    }
    if (sdk.type === "system" && sdk.subtype === "init") {
      return { model: sdk.model, uuid: sdk.uuid };
    }
  }
  return undefined;
};

/**
 * Composer model/effort state.
 *
 * Two layers, deliberately separate:
 * - REQUESTED: what the user picked for THIS conversation. Persisted on the
 *   conversation row and applied to the live CLI session at click time via
 *   the options endpoint (messages themselves carry no options — latest-wins
 *   under queueing). Global preferences only seed new conversations.
 * - ACTUAL: what the CLI reports running. Model echoes come from the
 *   transcript (see findModelEcho); effort comes from the Stop-hook echo
 *   relayed over SSE. Echoes fold back INTO the picker state so the UI
 *   never shows a model/effort the CLI isn't actually using — but they are
 *   never persisted as the requested selection.
 */
export const useComposerModel = (
  conversationId: string | null,
  conversation: ConversationWithMessages | undefined
) => {
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(
    undefined
  );
  const [selectedEffort, setSelectedEffort] = useState<EffortLevel | undefined>(
    undefined
  );

  // Global defaults — the picker's state before any conversation is active.
  // A selection made before the fetch resolves wins.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [model, effort] = await Promise.all([
        getPreference(MODEL_PREF_KEY),
        getPreference(EFFORT_PREF_KEY),
      ]);
      if (cancelled) return;
      if (model.isOk() && model.value) {
        const value = model.value;
        setSelectedModelId((prev) => prev ?? value);
      }
      if (effort.isOk() && effort.value && isEffortLevel(effort.value)) {
        const value = effort.value;
        setSelectedEffort((prev) => prev ?? value);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed the picker from the conversation's requested state, once per
  // conversation (later row refetches must not clobber optimistic changes).
  const seededConversationId = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || !conversation) return;
    if (seededConversationId.current === conversationId) return;
    seededConversationId.current = conversationId;
    if (conversation.selectedModel) {
      setSelectedModelId(conversation.selectedModel);
    }
    if (conversation.selectedEffort) {
      setSelectedEffort(conversation.selectedEffort);
    }
  }, [conversationId, conversation]);

  const selectedModel =
    DEFAULT_MODELS.find((m) => matchesModel(m, selectedModelId)) ??
    DEFAULT_MODELS[0];
  const effortLevels = selectedModel?.supportedEffortLevels ?? [];
  const effectiveEffort = clampEffort(selectedEffort, effortLevels);

  const handleModelChange = (value: string, model: ModelInfo) => {
    setSelectedModelId(value);
    setPreference(MODEL_PREF_KEY, value);
    // Switching models can drop the current effort out of range — snap it.
    const clamped = clampEffort(
      selectedEffort,
      model.supportedEffortLevels ?? []
    );
    if (clamped && clamped !== selectedEffort) {
      setSelectedEffort(clamped);
      setPreference(EFFORT_PREF_KEY, clamped);
    }
    if (conversationId) {
      updateConversationOptions(conversationId, {
        model: value,
        ...(clamped ? { effort: clamped } : {}),
      });
    }
  };

  const handleEffortChange = (level: EffortLevel) => {
    setSelectedEffort(level);
    setPreference(EFFORT_PREF_KEY, level);
    if (conversationId) {
      updateConversationOptions(conversationId, { effort: level });
    }
  };

  // Fold NEW model echoes into the picker. The uuid ref makes each echo apply
  // once, so a pending user selection isn't clobbered by a stale transcript.
  const lastEchoUuid = useRef<string | null>(null);
  useEffect(() => {
    lastEchoUuid.current = null;
  }, [conversationId]);
  useEffect(() => {
    const echo = findModelEcho(conversation);
    if (!echo || lastEchoUuid.current === echo.uuid) return;
    lastEchoUuid.current = echo.uuid;
    if (!matchesModel(selectedModel, echo.model)) {
      const row = DEFAULT_MODELS.find((m) => matchesModel(m, echo.model));
      // Echo for a model outside the catalog can't be represented — skip.
      // Not persisted: echoes reflect CLI state, not the user's request.
      if (row) setSelectedModelId(row.value);
    }
  }, [conversation, selectedModel]);

  // Same for effort: the Stop-hook echo is the CLI's post-downgrade truth.
  const { data: actualEffort } = useActualEffort(conversationId);
  useEffect(() => {
    if (!actualEffort || !isEffortLevel(actualEffort)) return;
    setSelectedEffort((prev) => (prev === actualEffort ? prev : actualEffort));
  }, [actualEffort]);

  return {
    models: DEFAULT_MODELS,
    selectedModelId,
    effortLevels,
    effort: effectiveEffort,
    handleModelChange,
    handleEffortChange,
  };
};
