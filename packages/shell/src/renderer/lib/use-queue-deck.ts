import type { Message } from "@/main/api";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useConversationMessages,
  useFailedMessageIds,
  useQueuedMessageIds,
  useSendIntents,
  type SendIntent,
} from "./claude-code-ops";
import { EXIT_MS } from "./motion";

export type DeckRow = {
  message: Message;
  // Set while the row plays its exit. "accepted": the CLI took it, and the
  // transcript shows it once the exit ends. "cancelled": withdrawn, and gone
  // from the cache already — the row renders from the copy held here.
  leaving?: "accepted" | "cancelled";
};

export type DeckSources = {
  queued: ReadonlySet<string>;
  failed: ReadonlySet<string>;
  intents: Readonly<Record<string, SendIntent>>;
};

// Whether the queued deck shows a message instead of the transcript. It holds
// a prompt from the moment it is sent mid-turn until the CLI accepts it.
export const isInDeck = (m: Message, s: DeckSources): boolean => {
  if (m.messageType !== "user_prompt") return false;
  // Accepted: the backend placed it (acceptedAfterSeq), so it belongs to the
  // transcript now, at that place.
  if (m.acceptedAfterSeq != null) return false;
  // Never reached the CLI. The transcript's "Not delivered" still owns these.
  if (s.failed.has(m.id)) return false;
  const intent = s.intents[m.id];
  // Sent to an idle agent: it passes through the queue for the milliseconds
  // its ack takes, and must not flash through the deck on the way.
  if (intent === "direct") return false;
  // "queue" covers the bubble before the backend's `queue` event names it;
  // the queue itself covers everything this window did not send — a
  // conversation opened with messages already waiting.
  return intent === "queue" || s.queued.has(m.id);
};

// Rows that were in the deck and are not any more, and how each one left. A
// row still in the cache was accepted; one the cache no longer has was
// cancelled, and keeps the copy the deck last rendered.
export const departures = (
  before: readonly Message[],
  after: readonly Message[],
  all: readonly Message[],
): DeckRow[] => {
  const staying = new Set(after.map((m) => m.id));
  const now = new Map(all.map((m) => [m.id, m]));
  return before
    .filter((m) => !staying.has(m.id))
    .map((m) => {
      const row = now.get(m.id);
      return row
        ? { message: row, leaving: "accepted" as const }
        : { message: m, leaving: "cancelled" as const };
    });
};

const EMPTY: Message[] = [];

// The queued deck's rows, and which ids the transcript must leave to it: the
// rows in the deck, plus the ones still playing their exit. `revealedIds` are
// the ones the deck handed to the transcript, so it can play their entrance.
export const useQueueDeck = (conversationId: string | null) => {
  const { data: conversation } = useConversationMessages(conversationId);
  const { data: queuedIds } = useQueuedMessageIds(conversationId);
  const { data: failedIds } = useFailedMessageIds(conversationId);
  const { data: intents } = useSendIntents(conversationId);
  const messages = conversation?.messages ?? EMPTY;

  const current = useMemo(() => {
    const sources: DeckSources = {
      queued: new Set(queuedIds),
      failed: new Set(failedIds),
      intents: intents ?? {},
    };
    return messages.filter((m) => isInDeck(m, sources));
  }, [messages, queuedIds, failedIds, intents]);

  // Departures are found during render, not in an effect: an effect would
  // commit one frame without the departed row, unmounting it before its exit
  // could play. (React's "adjusting state when a prop changes" pattern.)
  const [tracked, setTracked] = useState({
    conversationId,
    current,
    leaving: [] as DeckRow[],
  });
  let leaving = tracked.leaving;
  if (tracked.conversationId !== conversationId) {
    leaving = [];
    setTracked({ conversationId, current, leaving });
  } else if (tracked.current !== current) {
    const back = new Set(current.map((m) => m.id));
    leaving = [
      ...tracked.leaving.filter((r) => !back.has(r.message.id)),
      ...departures(tracked.current, current, messages),
    ];
    setTracked({ conversationId, current, leaving });
  }

  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const timers = useRef(new Map<string, number>());
  useEffect(() => {
    for (const row of leaving) {
      const id = row.message.id;
      if (timers.current.has(id)) continue;
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id);
          setTracked((t) => ({
            ...t,
            leaving: t.leaving.filter((r) => r.message.id !== id),
          }));
          if (row.leaving === "accepted") {
            setRevealedIds((prev) => new Set(prev).add(id));
          }
        }, EXIT_MS),
      );
    }
  }, [leaving]);
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  // Send order, not transcript order: an accepted row carries its placement
  // while it exits, and must not jump within the deck as it goes.
  const rows = useMemo<DeckRow[]>(
    () =>
      [...current.map((message) => ({ message })), ...leaving].sort(
        (a, b) => a.message.seq - b.message.seq,
      ),
    [current, leaving],
  );
  const hiddenIds = useMemo<ReadonlySet<string>>(
    () => new Set(rows.map((r) => r.message.id)),
    [rows],
  );

  return { rows, hiddenIds, revealedIds };
};
