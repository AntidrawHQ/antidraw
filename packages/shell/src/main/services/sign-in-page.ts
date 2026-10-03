import antidrawIcon from "@/renderer/assets/antidraw-icon.svg?raw";

// The page the browser tab shows when Google sign-in comes back to the app's
// loopback server: in the middle of a plain page, the AntiDraw logo with a
// status mark, beside a title and a message saying how sign-in ended, in the
// Publish button's sign-in panel's type and colours. Self-contained, with
// inline styles and the logo inline, so it loads nothing; its headers forbid
// anything else.

export type SignInOutcome = "signed-in" | "cancelled" | "failed";

// The Publish button's colours (renderer/components/PublishButton.tsx).
const GREEN = "oklch(0.696 0.17 162.48)";
const RED = "oklch(0.704 0.191 22.216)";

const CHECK = `<path d="M20 6 9 17l-5-5"/>`;
const CROSS = `<path d="M18 6 6 18M6 6l12 12"/>`;

const COPY: Record<SignInOutcome, { title: string; message: string; color: string; mark: string }> = {
  "signed-in": {
    title: "You're signed in",
    message: "You can close this tab and return to AntiDraw.",
    color: GREEN,
    mark: CHECK,
  },
  cancelled: {
    title: "Sign-in cancelled",
    message: "Sign-in was cancelled in AntiDraw. You can close this tab.",
    color: RED,
    mark: CROSS,
  },
  failed: {
    title: "Sign-in didn't complete",
    message: "You can close this tab and try again in AntiDraw.",
    color: RED,
    mark: CROSS,
  },
};

// The page has no links, but its URL carries the authorization code: no
// referrer, no caching, and nothing loaded from anywhere.
export const SIGN_IN_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export const signInPage = (outcome: SignInOutcome) => {
  const { title, message, color, mark } = COPY[outcome];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title} · AntiDraw</title>
<style>
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid; place-items: center; padding: 24px;
    background: #262626; color: #e0e0e0;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  main { width: 100%; max-width: 420px; display: flex; gap: 16px; align-items: flex-start; }
  .logo { position: relative; flex: none; width: 52px; height: 52px; }
  .logo > svg { display: block; width: 52px; height: 52px; }
  .mark {
    position: absolute; right: -6px; bottom: -6px;
    display: grid; place-items: center; width: 22px; height: 22px;
    border-radius: 50%; box-shadow: 0 0 0 3px #262626;
    background: color-mix(in oklch, ${color} 16%, #262626); color: ${color};
  }
  .mark svg { width: 12px; height: 12px; }
  h1 { margin: 2px 0 0; font-size: 18px; font-weight: 500; letter-spacing: -0.01em; color: #e0e0e0; }
  p { margin: 4px 0 0; font-size: 14px; line-height: 1.6; color: #9a9a9a; text-wrap: pretty; }
</style>
</head>
<body>
<main>
  <div class="logo">${antidrawIcon}<span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${mark}</svg></span></div>
  <div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</main>
</body>
</html>`;
};
