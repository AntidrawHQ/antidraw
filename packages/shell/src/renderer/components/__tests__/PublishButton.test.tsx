// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionGlobalConfig } from "motion/react";
import { err, ok } from "neverthrow";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

// The Publish button and its sign-in panel in jsdom, with main's API faked:
// where focus goes, what Escape does, and what the panel says when something
// fails.

const api = vi.hoisted(() => ({
  getAccount: vi.fn(),
  signIn: vi.fn(),
  cancelSignIn: vi.fn(),
  signOut: vi.fn(),
  publishWorkspace: vi.fn(),
}));
vi.mock("@/renderer/lib/api", () => api);

const ADA = { id: "u1", name: "Ada", email: "ada@example.com", image: null };
const failure = (status: number, code: string) => err({ status, code, message: code });

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  MotionGlobalConfig.skipAnimations = true;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
});

let root: Root | undefined;
beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.getAccount.mockResolvedValue(ok(null));
  api.cancelSignIn.mockResolvedValue(ok(true));
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const render = async () => {
  const { PublishButton } = await import("../PublishButton");
  const client = new QueryClient();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root!.render(
      <QueryClientProvider client={client}>
        <PublishButton workspaceId="w1" workspaceName="Paper Shaders" />
      </QueryClientProvider>,
    ),
  );
};

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
const button = (name: RegExp) =>
  [...document.querySelectorAll("button")].find((b) => name.test(b.textContent ?? "") || name.test(b.getAttribute("aria-label") ?? ""))!;
const click = async (name: RegExp) => {
  await act(async () => button(name).click());
  await settle();
};
const key = async (key: string, shiftKey = false) => {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
  });
  await settle();
};
/** What a user sees and where focus is. */
const screen = () => {
  const dialog = document.querySelector('[role="dialog"]');
  const focused = document.activeElement;
  return {
    dialog: dialog ? [dialog.querySelector("h2")?.textContent, dialog.querySelector("p")?.textContent] : null,
    alert: document.querySelector('[role="alert"]')?.textContent ?? null,
    focus: focused === document.body ? "<body>" : (focused?.getAttribute("aria-label") ?? focused?.textContent?.trim()),
  };
};

it("opens the sign-in panel on Sign in, keeps Tab inside, and gives focus back on Escape", async () => {
  await render();
  await click(/^Publish$/);
  const opened = screen();
  await key("Tab"); // from the last control…
  const wrapped = screen().focus; // …to the first
  await key("Escape");
  expect({ opened, wrapped, closed: screen() }).toMatchInlineSnapshot(`
    {
      "closed": {
        "alert": null,
        "dialog": null,
        "focus": "Publish",
      },
      "opened": {
        "alert": null,
        "dialog": [
          "Sign in to publish",
          "Once you're signed in, Paper Shaders goes live on a link you can share.",
        ],
        "focus": "Sign in with Google",
      },
      "wrapped": "Close",
    }
  `);
});

it("goes back to Sign in on Escape while waiting for Google, and keeps focus on the button", async () => {
  api.signIn.mockReturnValue(new Promise(() => {}));
  await render();
  await click(/^Publish$/);
  await click(/Sign in with Google/);
  const waiting = { ...screen(), ariaDisabled: button(/Waiting for Google/).getAttribute("aria-disabled") };
  await key("Escape");
  expect({ waiting, afterEscape: screen(), cancelled: api.cancelSignIn.mock.calls.length }).toMatchInlineSnapshot(`
    {
      "afterEscape": {
        "alert": null,
        "dialog": [
          "Sign in to publish",
          "Once you're signed in, Paper Shaders goes live on a link you can share.",
        ],
        "focus": "Sign in with Google",
      },
      "cancelled": 1,
      "waiting": {
        "alert": null,
        "ariaDisabled": "true",
        "dialog": [
          "Sign in to publish",
          "Finish signing in with Google in your browser. We'll publish right after.",
        ],
        "focus": "Waiting for Google…",
      },
    }
  `);
});

it("says why sign-in failed, and leaves focus on Try again", async () => {
  api.signIn.mockResolvedValue(failure(401, "ACCESS_DENIED"));
  await render();
  await click(/^Publish$/);
  await click(/Sign in with Google/);
  expect(screen()).toMatchInlineSnapshot(`
    {
      "alert": "Sign-in was declined in Google.",
      "dialog": [
        "Sign in to publish",
        "Once you're signed in, Paper Shaders goes live on a link you can share.",
      ],
      "focus": "Try again",
    }
  `);
});

it("doesn't offer sign-in when the account can't be checked, and retries on Try again", async () => {
  api.getAccount.mockResolvedValue(failure(502, "SERVER_UNREACHABLE")); // at launch and on the click
  api.publishWorkspace.mockResolvedValue(ok({ url: "https://antidraw.com/s/paper-shaders" }));
  await render();
  await click(/^Publish$/);
  const unreachable = screen();
  api.getAccount.mockResolvedValue(ok(ADA));
  await click(/Try again/);
  expect({
    unreachable,
    retried: { published: api.publishWorkspace.mock.calls, toast: document.querySelector('[role="status"].fixed')?.textContent },
  }).toMatchInlineSnapshot(`
    {
      "retried": {
        "published": [
          [
            "w1",
          ],
        ],
        "toast": "Publishedantidraw.com/s/paper-shadersCopy link",
      },
      "unreachable": {
        "alert": "Couldn't reach AntiDraw. Check your connection and try again.",
        "dialog": [
          "Couldn't publish",
          "We couldn't check your account, so Paper Shaders wasn't published.",
        ],
        "focus": "Try again",
      },
    }
  `);
});

it("asks again on every click, so a sign-in that finished elsewhere publishes", async () => {
  api.publishWorkspace.mockResolvedValue(ok({ url: "https://antidraw.com/s/paper-shaders" }));
  await render();
  api.getAccount.mockResolvedValue(ok(ADA)); // signed in after the app loaded
  await click(/^Publish$/);
  expect({ dialog: screen().dialog, published: api.publishWorkspace.mock.calls.length }).toMatchInlineSnapshot(`
    {
      "dialog": null,
      "published": 1,
    }
  `);
});
