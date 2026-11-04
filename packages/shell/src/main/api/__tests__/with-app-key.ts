import { APP_KEY, APP_KEY_HEADER } from "@/main/lib/app-key";

// A request as the app's own pages make it: every /api route wants the app
// key (lib/app-key.ts).
export const withAppKey = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string>), [APP_KEY_HEADER]: APP_KEY },
});
