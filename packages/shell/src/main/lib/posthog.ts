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

// Cached account lookup. The signed-in account is the same regardless of which
// conversation triggered the call, so resolve it once per process and reuse.
let accountPromise: Promise<AccountInfo | null> | null = null;
let identified = false;

const resolveAccount = (query: Query): Promise<AccountInfo | null> => {
  if (!accountPromise) {
    accountPromise = (async () => {
      try {
        const init = await query.initializationResult();
        return init.account ?? null;
      } catch (e) {
        console.error("[posthog] failed to read account info:", e);
        accountPromise = null; // allow a later retry
        return null;
      }
    })();
  }
  return accountPromise;
};

const distinctIdFor = (account: AccountInfo | null): string =>
  account?.email ?? getAnonymousId();

// Person properties so PostHog can segment users by who they are.
const identifyOnce = (account: AccountInfo | null) => {
  if (!client || identified || !account) return;
  identified = true;
  client.identify({
    distinctId: distinctIdFor(account),
    properties: {
      email: account.email,
      organization: account.organization,
      subscription_type: account.subscriptionType,
      api_provider: account.apiProvider,
    },
  });
};

const baseProperties = () => ({
  app_version: app.getVersion(),
  platform: process.platform,
});

/**
 * Fire-and-forget capture of a "message_sent" event, enriched with the
 * signed-in user's account info pulled from the live Query object plus the
 * app version. First cut: user info + app version only.
 *
 * Resilient by design: never throws into the caller's stream loop.
 */
export const captureMessageSent = (params: { query: Query }): void => {
  if (!client) return;

  void resolveAccount(params.query)
    .then((account) => {
      if (!client) return;
      identifyOnce(account);
      client.capture({
        distinctId: distinctIdFor(account),
        event: "message_sent",
        properties: baseProperties(),
      });
    })
    .catch((e) => console.error("[posthog] captureMessageSent failed:", e));
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
