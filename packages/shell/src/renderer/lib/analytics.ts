import type { AnalyticsProperties, RendererEvent } from "@/shared/analytics";

// A content-free product event, sent through main (main/lib/posthog.ts),
// which holds the key and the install's identity. Counts, enums and ids
// only: never what the user wrote or named. A no-op where there's no preload
// (the tests, a page outside the app's windows).
export const track = (event: RendererEvent, properties?: AnalyticsProperties) => {
  try {
    window.electronAPI?.track?.(event, properties);
  } catch {
    // Analytics never breaks the app.
  }
};
