import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { PostHog } from "posthog-node";
import type { AccountInfo, Query } from "@anthropic-ai/claude-agent-sdk";
import type { AnalyticsProperties } from "@/shared/analytics";

// PostHog project API key. This is the PUBLIC, write-only key (starts with
// `phc_`) and is safe to ship inside the client.
const POSTHOG_KEY = "phc_C24zwg6R3ZE05tNbePZBkwrXfS4s84VMGNpmXSupROT";

// US Cloud ingestion host.
const POSTHOG_HOST = "https://us.i.posthog.com";

// A real key starts with `phc_`; the placeholder does not, which keeps the
// integration fully inert (no client created, every capture is a no-op) until
// a real key is pasted in.
const isConfigured = POSTHOG_KEY.startsWith("phc_") && POSTHOG_KEY.length > 10;

// Packaged builds only, so development doesn't count as usage.
// ANTIDRAW_ANALYTICS=1 sends from a dev build, to check an event lands.
// `app?.`: under the tests, electron is not the runtime and there is no app.
const isEnabled = () =>
  isConfigured && (app?.isPackaged === true || process.env.ANTIDRAW_ANALYTICS === "1");

// Made on first use, not at import: `app` has to be asked.
let client: PostHog | null | undefined;
const getClient = (): PostHog | null => {
  if (client === undefined) {
    client = isEnabled()
      ? new PostHog(POSTHOG_KEY, {
          host: POSTHOG_HOST,
          // Desktop app: flush eagerly so events aren't lost on quit.
          flushAt: 1,
          flushInterval: 10_000,
        })
      : null;
  }
  return client;
};

// ============================================================================
// Identity
// ============================================================================

// A random id for this install, made on first launch: the distinct_id of
// every event, so the first launch and onboarding are seen too, long before
// a Claude account is known. Once one is (trackMessageSent), the install is
// aliased to its email, and both name one person.
type Identity = { installId: string; aliased: string[]; isNew: boolean };

let identity: Identity | undefined;
const identityPath = () => path.join(app.getPath("userData"), "analytics.json");

const getIdentity = (): Identity => {
  if (identity) return identity;
  try {
    const saved = JSON.parse(fs.readFileSync(identityPath(), "utf-8")) as Partial<Identity>;
    if (typeof saved.installId === "string") {
      identity = {
        installId: saved.installId,
        aliased: Array.isArray(saved.aliased) ? saved.aliased.filter((e) => typeof e === "string") : [],
        isNew: false,
      };
      return identity;
    }
  } catch {
    // None yet, or unreadable: a new one below.
  }
  identity = { installId: randomUUID(), aliased: [], isNew: true };
  saveIdentity(identity);
  return identity;
};

const saveIdentity = ({ installId, aliased }: Identity) => {
  try {
    fs.writeFileSync(identityPath(), JSON.stringify({ installId, aliased }));
  } catch (e) {
    console.error("[posthog] failed to save the install id:", e);
  }
};

/** Whether this launch made the install id: none was saved before it. */
export const isNewInstall = (): boolean => (getClient() ? getIdentity().isNew : false);

const appProperties = () => ({
  app_version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
});

// ============================================================================
// Events
// ============================================================================

/**
 * Fire-and-forget capture of a content-free event under this install's id,
 * with the app's version, platform and arch. `set` adds to the person's
 * profile, which every event refreshes with those three. Never throws into
 * the caller.
 */
export const track = (
  event: string,
  properties: AnalyticsProperties = {},
  set?: Record<string, string | number | boolean | null>,
): void => {
  const posthog = getClient();
  if (!posthog) return;
  try {
    posthog.capture({
      distinctId: getIdentity().installId,
      event,
      properties: {
        ...appProperties(),
        ...properties,
        $set: { ...appProperties(), ...set },
      },
    });
  } catch (e) {
    console.error(`[posthog] track ${event} failed:`, e);
  }
};

// Joins this install to the account's person, once per email.
const aliasInstall = (posthog: PostHog, email: string) => {
  const id = getIdentity();
  if (id.aliased.includes(email)) return;
  posthog.alias({ distinctId: email, alias: id.installId });
  id.aliased.push(email);
  saveIdentity(id);
};

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
  if (!getClient()) return;

  (async () => {
    let account: AccountInfo | null = null;
    try {
      const init = await params.query.initializationResult();
      account = init.account ?? null;
    } catch (e) {
      console.error("[posthog] failed to read account info:", e);
    }

    // Bail unless we have a signed-in email — it's this event's distinct_id,
    // and what the install is aliased to. No email means we don't know who
    // the user is, so we skip rather than emit a junk event.
    const posthog = getClient();
    if (!posthog || !account?.email) return;

    aliasInstall(posthog, account.email);

    posthog.capture({
      distinctId: account.email,
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
