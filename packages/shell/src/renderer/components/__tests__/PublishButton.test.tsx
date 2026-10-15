// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionGlobalConfig } from "motion/react";
import { err, ok } from "neverthrow";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { PublishStreamEvent } from "@/main/api";
import { usePublishStore } from "@/renderer/store/publish";

// The Publish button, its publish panel and its sign-in panel in jsdom, with
// main's API faked: what the panel shows as a publish goes, where focus goes,
// what Escape does, and what the panel offers when something fails.

const api = vi.hoisted(() => ({
  getAccount: vi.fn(),
  signIn: vi.fn(),
  cancelSignIn: vi.fn(),
  signOut: vi.fn(),
  publishWorkspace: vi.fn(),
}));
vi.mock("@/renderer/lib/api", () => api);

const chat = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/renderer/hooks/use-send-to-chat", () => ({ useSendToChat: () => ({ send: chat.send, isPending: false }) }));
vi.mock("@/renderer/hooks/use-composer-model", () => ({
  useComposerModel: () => ({ selectedModelId: "opus", effort: "high" }),
}));

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

/** main's publish stream: pushed to by the test, or played whole. */
const channel = () => {
  const queue: PublishStreamEvent[] = [];
  let wake = () => {};
  let ended = false;
  async function* stream() {
    for (;;) {
      if (queue.length) yield queue.shift()!;
      else if (ended) return;
      else await new Promise<void>((resolve) => (wake = resolve));
    }
  }
  return {
    stream,
    push: (...events: PublishStreamEvent[]) =>
      act(async () => {
        queue.push(...events);
        wake();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }),
    end: () => {
      ended = true;
      wake();
    },
  };
};
const play = async function* (...events: PublishStreamEvent[]) {
  yield* events;
};

const LIVE: PublishStreamEvent[] = [
  { type: "step", step: "runtime" },
  { type: "meta", step: "runtime", text: "0.6.0" },
  { type: "step", step: "build" },
  { type: "log", line: "✓ built in 3.12s" },
  { type: "meta", step: "build", text: "3.1s · 451 kB" },
  { type: "step", step: "upload" },
  { type: "upload", done: 1, total: 1, unchanged: 0, file: "index.html" },
  { type: "meta", step: "upload", text: "1 files" },
  { type: "step", step: "live" },
  { type: "done", url: "https://antidraw.com/s/paper-shaders" },
];

let root: Root | undefined;
beforeEach(() => {
  for (const fn of [...Object.values(api), chat.send]) fn.mockReset();
  api.getAccount.mockResolvedValue(ok(null));
  api.cancelSignIn.mockResolvedValue(ok(true));
  api.publishWorkspace.mockImplementation(() => play(...LIVE));
  chat.send.mockResolvedValue("c1");
  usePublishStore.setState({ runs: {} });
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

type Workspace = { id: string; name: string; siteUrl?: string; publishedAt?: number };
const render = async (workspace: Workspace = { id: "w1", name: "Paper Shaders" }) => {
  const { PublishButton } = await import("../PublishButton");
  const client = new QueryClient();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  const show = (ws: Workspace) =>
    root!.render(
      <QueryClientProvider client={client}>
        <PublishButton workspaceId={ws.id} workspaceName={ws.name} siteUrl={ws.siteUrl} publishedAt={ws.publishedAt} />
      </QueryClientProvider>,
    );
  await act(async () => show(workspace));
};

const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
const named = (name: RegExp) => (b: Element) => name.test(b.textContent ?? "") || name.test(b.getAttribute("aria-label") ?? "");
const button = (name: RegExp) => [...document.querySelectorAll("button")].find(named(name))!;
/** The titlebar's button. */
const titlebar = () => document.querySelector("button")!;
const inPanel = (name: RegExp) => [...document.querySelectorAll('[role="dialog"] button')].find(named(name)) as HTMLButtonElement;
const click = async (target: HTMLElement) => {
  await act(async () => target.click());
  await settle();
};
const key = async (key: string, shiftKey = false) => {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }));
  });
  await settle();
};
const outside = async () => {
  await act(async () => {
    document.querySelector("[data-publish-overlay]")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  await settle();
};
/** Publish in the titlebar, then in the confirm view. */
const publish = async () => {
  await click(titlebar());
  await click(inPanel(/^Publish( changes)?$/));
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
/** The step list: ✓ done, … running, ✗ failed, · not yet. */
const steps = () =>
  [...document.querySelectorAll('[role="dialog"] .py-2.items-center')].map((row) => {
    const icon = row.querySelector("svg");
    const mark =
      icon?.getAttribute("fill") === "#7c6cd6" ? "✓" : icon?.getAttribute("fill") === "#d9605c" ? "✗" : icon?.classList.contains("animate-spin") ? "…" : "·";
    return `${mark} ${row.textContent}`;
  });
const actions = () => [...document.querySelectorAll('[role="dialog"] [role="alert"] + div button')].map((b) => b.textContent);

it("opens a confirm view on Publish, and starts nothing until its Publish", async () => {
  await render();
  await click(titlebar());
  expect({ ...screen(), pressed: titlebar().getAttribute("aria-expanded"), published: api.publishWorkspace.mock.calls.length })
    .toMatchInlineSnapshot(`
      {
        "alert": null,
        "dialog": [
          "Publish Paper Shaders",
          "First publish. You'll get a new link.",
        ],
        "focus": "Publish",
        "pressed": "true",
        "published": 0,
      }
    `);
});

it("says where a republish goes and when it last went live", async () => {
  await render({ id: "w1", name: "Paper Shaders", siteUrl: "https://antidraw.com/s/paper-shaders", publishedAt: Date.now() - 2 * 86_400_000 });
  await click(titlebar());
  expect(screen()).toMatchInlineSnapshot(`
    {
      "alert": null,
      "dialog": [
        "Publish Paper Shaders",
        "antidraw.com/s/paper-shaders · live 2d ago",
      ],
      "focus": "Publish changes",
    }
  `);
});

it("shows each step as it runs, can't be closed meanwhile, and ends on the link", async () => {
  api.getAccount.mockResolvedValue(ok(ADA));
  const c = channel();
  api.publishWorkspace.mockImplementation(c.stream);
  await render();
  await publish();
  await c.push(
    { type: "step", step: "runtime" },
    { type: "meta", step: "runtime", text: "0.6.0" },
    { type: "step", step: "build" },
    { type: "log", line: "vite v7.0.6 building for production..." },
    { type: "log", line: "transforming..." },
  );
  const building = { steps: steps(), log: [...document.querySelectorAll('[role="dialog"] span.block.font-mono')].map((line) => line.textContent), button: titlebar().textContent };
  await key("Escape");
  await outside();
  const stillOpen = screen().dialog;
  await c.push(
    { type: "meta", step: "build", text: "3.1s · 451 kB" },
    { type: "step", step: "upload" },
    { type: "upload", done: 3, total: 11, unchanged: 31, file: "assets/index.js" },
  );
  const uploading = { steps: steps(), button: titlebar().textContent };
  await c.push(
    { type: "meta", step: "upload", text: "11 sent · 31 cached" },
    { type: "step", step: "live" },
    { type: "done", url: "https://antidraw.com/s/paper-shaders" },
  );
  c.end();
  await settle();
  const live = { ...screen(), link: document.querySelector('[role="dialog"] .font-mono')?.textContent, button: titlebar().textContent };
  await click(inPanel(/^Close$/));
  await click(titlebar());
  expect({ building, stillOpen, uploading, live, reopened: screen().dialog, published: api.publishWorkspace.mock.calls })
    .toMatchInlineSnapshot(`
      {
        "building": {
          "button": "Building",
          "log": [
            "vite v7.0.6 building for production...",
            "transforming...",
          ],
          "steps": [
            "✓ Checking accountada",
            "✓ Checking runtime0.6.0",
            "… Building site",
            "· Uploading files",
            "· Going live",
          ],
        },
        "live": {
          "alert": null,
          "button": "Published",
          "dialog": [
            "Paper Shaders is live",
            "Your link is ready to share.",
          ],
          "focus": "Paper Shaders is live",
          "link": "antidraw.com/s/paper-shaders",
        },
        "published": [
          [
            "w1",
          ],
        ],
        "reopened": [
          "Publish Paper Shaders",
          "First publish. You'll get a new link.",
        ],
        "stillOpen": [
          "Publishing Paper Shaders",
          "First publish.",
        ],
        "uploading": {
          "button": "Uploading",
          "steps": [
            "✓ Checking accountada",
            "✓ Checking runtime0.6.0",
            "✓ Building site3.1s · 451 kB",
            "… Uploading files27%",
            "· Going live",
          ],
        },
      }
    `);
});

it("keeps a build's error open, and sends it to a new chat on Ask agent", async () => {
  api.getAccount.mockResolvedValue(ok(ADA));
  api.publishWorkspace.mockImplementation(() =>
    play(
      { type: "step", step: "runtime" },
      { type: "step", step: "build" },
      { type: "log", line: "error during build:" },
      { type: "error", code: "BUILD_FAILED", message: "Couldn't build the workspace.\nerror during build:\nCard.tsx:2:0: ERROR: Unexpected end of file" },
    ),
  );
  await render();
  await publish();
  const failed = { ...screen(), steps: steps(), actions: actions(), button: titlebar().textContent };
  await click(inPanel(/Ask agent/));
  await click(inPanel(/Sent to agent/)); // once is enough
  expect({ failed, sent: chat.send.mock.calls, actions: actions() }).toMatchInlineSnapshot(`
    {
      "actions": [
        "Sent to agent",
        "Try again",
      ],
      "failed": {
        "actions": [
          "Ask agent",
          "Try again",
        ],
        "alert": "Couldn't build the workspace.",
        "button": "Publish",
        "dialog": [
          "Couldn't publish",
          "First publish.",
        ],
        "focus": "Publish Paper Shaders",
        "steps": [
          "✓ Checking accountada",
          "✓ Checking runtime",
          "✗ Building site",
          "· Uploading files",
          "· Going live",
        ],
      },
      "sent": [
        [
          {
            "effort": "high",
            "model": "opus",
            "prompt": "Publishing Paper Shaders failed: \`vite build\` couldn't build the workspace. Fix the error so the site builds.

    \`\`\`
    error during build:
    Card.tsx:2:0: ERROR: Unexpected end of file
    \`\`\`",
            "target": {
              "conversationId": null,
              "workspaceId": "w1",
            },
            "title": "Fix the build error in Paper Shaders",
          },
        ],
      ],
    }
  `);
});

it("offers the way forward that fits each failure, and Try again runs it all again", async () => {
  api.getAccount.mockResolvedValue(ok(ADA));
  const failing = (step: "runtime" | "upload", code: string, message: string) => () =>
    play({ type: "step", step: "runtime" }, ...(step === "upload" ? [{ type: "step", step: "upload" } as const] : []), { type: "error", code, message });
  api.publishWorkspace
    .mockImplementationOnce(failing("runtime", "RUNTIME_TOO_OLD", "This workspace has @antidrawapp/runtime 0.4.2. Publishing needs 0.5.0 or later."))
    .mockImplementationOnce(failing("upload", "UPLOAD_FAILED", "Couldn't upload the site: the connection was reset"));
  await render();
  await publish();
  const oldRuntime = { alert: screen().alert, steps: steps(), actions: actions() };
  await click(inPanel(/Try again/));
  const uploadDropped = { alert: screen().alert, actions: actions() };
  await click(inPanel(/Resume upload/));
  expect({ oldRuntime, uploadDropped, live: screen().dialog, published: api.publishWorkspace.mock.calls.length }).toMatchInlineSnapshot(`
    {
      "live": [
        "Paper Shaders is live",
        "Your link is ready to share.",
      ],
      "oldRuntime": {
        "actions": [
          "Try again",
        ],
        "alert": "This workspace has @antidrawapp/runtime 0.4.2. Publishing needs 0.5.0 or later.",
        "steps": [
          "✓ Checking accountada",
          "✗ Checking runtime",
          "· Building site",
          "· Uploading files",
          "· Going live",
        ],
      },
      "published": 3,
      "uploadDropped": {
        "actions": [
          "Resume upload",
        ],
        "alert": "Couldn't upload the site: the connection was reset",
      },
    }
  `);
});

it("keeps a failure until it's tried again, even across closing the panel", async () => {
  api.getAccount.mockResolvedValue(ok(ADA));
  api.publishWorkspace.mockImplementation(() => play({ type: "error", code: "SERVER_ERROR", message: "Couldn't reach Antidraw. Check your connection and try again." }));
  await render();
  await publish();
  await key("Escape");
  const closed = { dialog: screen().dialog, button: titlebar().textContent };
  await click(titlebar());
  expect({ closed, reopened: screen() }).toMatchInlineSnapshot(`
    {
      "closed": {
        "button": "Publish",
        "dialog": null,
      },
      "reopened": {
        "alert": "Couldn't reach Antidraw. Check your connection and try again.",
        "dialog": [
          "Couldn't publish",
          "First publish.",
        ],
        "focus": "Publish Paper Shaders",
      },
    }
  `);
});

it("fails the account step when the account can't be checked, and retries on Try again", async () => {
  api.getAccount.mockResolvedValue(failure(502, "SERVER_UNREACHABLE")); // at launch and on the click
  await render();
  await publish();
  const unreachable = { ...screen(), steps: steps() };
  api.getAccount.mockResolvedValue(ok(ADA));
  await click(inPanel(/Try again/));
  expect({ unreachable, retried: { dialog: screen().dialog, published: api.publishWorkspace.mock.calls } }).toMatchInlineSnapshot(`
    {
      "retried": {
        "dialog": [
          "Paper Shaders is live",
          "Your link is ready to share.",
        ],
        "published": [
          [
            "w1",
          ],
        ],
      },
      "unreachable": {
        "alert": "Couldn't reach Antidraw. Check your connection and try again.",
        "dialog": [
          "Couldn't publish",
          "First publish.",
        ],
        "focus": "Publish Paper Shaders",
        "steps": [
          "✗ Checking account",
          "· Checking runtime",
          "· Building site",
          "· Uploading files",
          "· Going live",
        ],
      },
    }
  `);
});

it("asks again on every run, so a sign-in that finished elsewhere publishes", async () => {
  await render();
  api.getAccount.mockResolvedValue(ok(ADA)); // signed in after the app loaded
  await publish();
  expect({ dialog: screen().dialog, published: api.publishWorkspace.mock.calls.length }).toMatchInlineSnapshot(`
    {
      "dialog": [
        "Paper Shaders is live",
        "Your link is ready to share.",
      ],
      "published": 1,
    }
  `);
});

it("checks the account once for a double click on Try again", async () => {
  api.getAccount.mockResolvedValue(failure(502, "SERVER_UNREACHABLE"));
  await render();
  await publish();
  const check = deferred<unknown>();
  api.getAccount.mockReturnValue(check.promise);
  await act(async () => {
    inPanel(/Try again/).click();
    inPanel(/Try again/)?.click();
  });
  const checking = steps();
  await act(async () => check.resolve(ok(ADA)));
  await settle();
  expect({ checking, checks: api.getAccount.mock.calls.length, published: api.publishWorkspace.mock.calls.length }).toMatchInlineSnapshot(`
    {
      "checking": [
        "… Checking account",
        "· Checking runtime",
        "· Building site",
        "· Uploading files",
        "· Going live",
      ],
      "checks": 3,
      "published": 1,
    }
  `);
});

it("opens the sign-in panel when signed out, keeps Tab inside, and gives focus back on Escape", async () => {
  await render();
  await publish();
  const opened = screen();
  await key("Tab"); // from the last control…
  const wrapped = screen().focus; // …to the first
  await key("Escape");
  expect({ opened, wrapped, closed: screen(), published: api.publishWorkspace.mock.calls.length }).toMatchInlineSnapshot(`
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
      "published": 0,
      "wrapped": "Close",
    }
  `);
});

it("goes back to Sign in on Escape while waiting for Google, and keeps focus on the button", async () => {
  api.signIn.mockReturnValue(new Promise(() => {}));
  await render();
  await publish();
  await click(button(/Sign in with Google/));
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
  await publish();
  await click(button(/Sign in with Google/));
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

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

it("publishes once, after a beat of Connected, when sign-in succeeds", async () => {
  api.signIn.mockResolvedValue(ok(ADA));
  await render();
  await publish();
  await click(button(/Sign in with Google/));
  const connected = { label: button(/Connected/)?.textContent, published: api.publishWorkspace.mock.calls.length };
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 600))));
  expect({ connected, after: { dialog: screen().dialog, steps: steps(), published: api.publishWorkspace.mock.calls.length } })
    .toMatchInlineSnapshot(`
      {
        "after": {
          "dialog": [
            "Paper Shaders is live",
            "Your link is ready to share.",
          ],
          "published": 1,
          "steps": [],
        },
        "connected": {
          "label": "Connected",
          "published": 0,
        },
      }
    `);
});

it("doesn't publish when sign-in finishes after the panel was closed", async () => {
  const signedIn = deferred<unknown>();
  api.signIn.mockReturnValue(signedIn.promise);
  await render();
  await publish();
  await click(button(/Sign in with Google/));
  await click(button(/^Close$/));
  await act(async () => signedIn.resolve(ok(ADA)));
  await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 600))));
  expect({ dialog: screen().dialog, published: api.publishWorkspace.mock.calls.length }).toMatchInlineSnapshot(`
    {
      "dialog": null,
      "published": 0,
    }
  `);
});

it("asks to sign in again when the publish finds the session gone", async () => {
  api.getAccount.mockResolvedValue(ok(ADA));
  api.publishWorkspace.mockImplementation(() => play({ type: "step", step: "runtime" }, { type: "error", code: "SIGNED_OUT", message: "Not signed in" }));
  await render();
  await publish();
  expect({ dialog: screen().dialog, button: titlebar().textContent }).toMatchInlineSnapshot(`
    {
      "button": "Publish",
      "dialog": [
        "Sign in to publish",
        "Once you're signed in, Paper Shaders goes live on a link you can share.",
      ],
    }
  `);
});

it("ignores Enter on the panel as it closes", async () => {
  await render();
  await publish();
  await act(async () => {
    const signIn = button(/Sign in with Google/);
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    signIn.click(); // Enter on the focused button, before the exit animation ends
  });
  await settle();
  expect({ dialog: screen().dialog, signIns: api.signIn.mock.calls.length }).toMatchInlineSnapshot(`
    {
      "dialog": null,
      "signIns": 0,
    }
  `);
});

it("takes clicks outside the panel: closes it, but not while waiting for Google", async () => {
  api.signIn.mockReturnValue(new Promise(() => {}));
  await render();
  await publish();
  await click(button(/Sign in with Google/));
  await outside();
  const waiting = screen().dialog?.[1];
  await key("Escape"); // back to Sign in
  await outside();
  expect({ waiting, afterOutsideClick: screen().dialog }).toMatchInlineSnapshot(`
    {
      "afterOutsideClick": null,
      "waiting": "Finish signing in with Google in your browser. We'll publish right after.",
    }
  `);
});

it("ignores Escape on the panel while it animates out", async () => {
  MotionGlobalConfig.skipAnimations = false;
  try {
    api.signIn.mockReturnValue(new Promise(() => {}));
    await render();
    await publish();
    await click(button(/Sign in with Google/));
    await act(async () => button(/^Close$/).click());
    await key("Escape"); // reaches the exiting panel
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 400))));
    expect(screen().dialog).toMatchInlineSnapshot(`null`);
  } finally {
    MotionGlobalConfig.skipAnimations = true;
  }
});

it("puts focus on Try again when sign-in fails while focus is on Cancel", async () => {
  const signedIn = deferred<unknown>();
  api.signIn.mockReturnValue(signedIn.promise);
  await render();
  await publish();
  await click(button(/Sign in with Google/));
  await act(async () => button(/^Cancel$/).focus());
  await act(async () => signedIn.resolve(failure(408, "TIMED_OUT")));
  await settle();
  expect(screen()).toMatchInlineSnapshot(`
    {
      "alert": "Sign-in timed out. Try again.",
      "dialog": [
        "Sign in to publish",
        "Once you're signed in, Paper Shaders goes live on a link you can share.",
      ],
      "focus": "Try again",
    }
  `);
});
