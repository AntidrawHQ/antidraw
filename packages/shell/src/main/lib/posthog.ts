import { randomUUID } from "node:crypto";
import { app } from "electron";
import { PostHog } from "posthog-node";
import Store from "electron-store";
import type { AccountInfo, Query } from "@anthropic-ai/claude-agent-sdk";

// PostHog project API key. This is the PUBLIC, write-only key (starts with
// `phc_`) and is safe to ship inside the client.
const POSTHOG_KEY = "phc_C24zwg6R3ZE05tNbePZBkwrXfS4s84VMGNpmXSupROT";

// US Cloud ingestion host.
const POSTHOG_HOST = "https://us.i.posthog.com";

// A real key starts with `phc_`; the placeholder does not, which keeps the
// integration fully inert (no client created, every capture is a no-op) until
// a real key is pasted in.
const isConfigured = POSTHOG_KEY.startsWith("phc_") && POSTHOG_KEY.length > 10;

// Stable per-install anonymous id, used as the PostHog distinct_id when no
// signed-in email is available yet. Persisted so the same machine maps to the
// same person across launches.
type AnalyticsStoreSchema = { anonymousId: string };
const analyticsStore = new Store<AnalyticsStoreSchema>({
  name: "analytics",
  defaults: { anonymousId: "" },
});

const getAnonymousId = (): string => {
  let id = analyticsStore.get("anonymousId");
  if (!id) {
    id = randomUUID();
    analyticsStore.set("anonymousId", id);
  }
  return id;
};

const client: PostHog | null = isConfigured
  ? new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      // Desktop app: flush eagerly so events aren't lost on quit.
      flushAt: 1,
      flushInterval: 10_000,
    })
  : null;

const distinctIdFor = (account: AccountInfo | null): string =>
  account?.email ?? getAnonymousId();

/**
 * Fire-and-forget tracking of a sent message, called on every query. Reads the
 * signed-in account fresh from the Query each time (no caching) so the identity
 * always reflects the *currently* logged-in Claude account — if the user logs
 * out and into a different account, the next event reports the new one.
 *
 * Captures a CONTENT-FREE `message_sent` event (volume per user) and refreshes
 * the person profile via `$set` in the same call — so no separate identify and
 * no dedup are needed; PostHog upserts the person idempotently. We never read,
 * store, or send message content.
 *
 * Resilient by design: never throws into the caller's stream loop.
 */
export const trackMessageSent = (params: { query: Query }): void => {
  if (!client) return;

  (async () => {
    let account: AccountInfo | null = null;
    try {
      const init = await params.query.initializationResult();
      account = init.account ?? null;
    } catch (e) {
      console.error("[posthog] failed to read account info:", e);
    }

    // Bail if we couldn't read the account (e.g. init failed). Without it we'd
    // emit a junk event under an anonymous id with an empty $set, polluting the
    // data with a phantom person. Only track when we know who the user is.
    if (!client || !account) return;

    client.capture({
      distinctId: distinctIdFor(account),
      event: "message_sent",
      properties: {
        app_version: app.getVersion(),
        platform: process.platform,
        // Refresh the person profile with the current account on every event.
        $set: {
          email: account.email,
          organization: account.organization,
          subscription_type: account.subscriptionType,
          api_provider: account.apiProvider,
          app_version: app.getVersion(),
          platform: process.platform,
        },
      },
    });
  })().catch((e) => console.error("[posthog] trackMessageSent failed:", e));
};

/** Flush any buffered events before the app exits. */
export const shutdownPostHog = async (): Promise<void> => {
  if (!client) return;
  try {
    await client.shutdown();
  } catch (e) {
    console.error("[posthog] shutdown failed:", e);
  }
};
