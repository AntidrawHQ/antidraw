// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  AskUserQuestion,
  AskUserQuestionCard,
  type AskUserQuestionCardProps,
} from "../AskUserQuestionCard";
import { DENY_MESSAGES, type AskUserQuestionInput } from "@/shared/utils/ask-user-question";
import { queryKeys } from "@/renderer/lib/query-keys";

// The card in jsdom: what it shows in each state, and what it hands onSubmit
// for a given set of clicks. The connected card is covered at the end, with
// only fetch faked — what happens when the backend says no.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The border beam measures its box and reads the color scheme; jsdom has
  // neither.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const LAYOUT = "Which layout should the hero use?";
const SECTIONS = "Which sections should follow it?";

const input: AskUserQuestionInput = {
  questions: [
    {
      question: LAYOUT,
      header: "Layout",
      multiSelect: false,
      options: [
        { label: "Split hero", description: "Copy left, shot right", preview: "[copy] [shot]" },
        { label: "Centered (Recommended)", description: "Headline over an image" },
      ],
    },
    {
      question: SECTIONS,
      header: "Sections",
      multiSelect: true,
      options: [
        { label: "Pricing", description: "Three tiers" },
        { label: "FAQ", description: "Accordion" },
      ],
    },
  ],
};

const one: AskUserQuestionInput = { questions: [input.questions[0]!] };
const multi: AskUserQuestionInput = { questions: [input.questions[1]!] };

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const render = (props: Partial<AskUserQuestionCardProps> = {}) => {
  const onSubmit = vi.fn();
  const onDecline = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const draw = (more: Partial<AskUserQuestionCardProps> = {}) =>
    act(() =>
      root!.render(
        <AskUserQuestionCard
          input={input}
          state="input-available"
          pending
          answered={null}
          onSubmit={onSubmit}
          onDecline={onDecline}
          {...props}
          {...more}
        />,
      ),
    );
  draw();
  return { onSubmit, onDecline, rerender: draw };
};

const card = () => document.querySelector<HTMLElement>('[data-testid="ask-user-question"]')!;

// By its text, or by its title for the round send button.
const button = (name: string) => {
  const found = [...card().querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.title === name || b.textContent?.startsWith(name),
  );
  if (!found) throw new Error(`no button "${name}"`);
  return found;
};

const click = (el: HTMLElement) => act(() => el.click());

const other = () => card().querySelector<HTMLInputElement>("input")!;

// React tracks an input's value itself; setting .value directly would be
// overwritten on the next render. The native setter plus an input event is
// what a keystroke amounts to.
const type = (text: string) => {
  const el = other();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const off = (b: HTMLButtonElement) => (b.disabled ? " (disabled)" : "");

// Everything a user can see or reach on an open card, as data.
const view = () => {
  const c = card();
  const head = c.firstElementChild!.firstElementChild!;
  const send = [...c.querySelectorAll<HTMLButtonElement>("button[title]")].find((b) => !b.getAttribute("role"));
  const skip = [...head.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Skip");
  return {
    tabs: [...c.querySelectorAll<HTMLButtonElement>("[role=tab]")].map(
      (t) => `${t.getAttribute("aria-selected") === "true" ? ">" : t.querySelector("svg") ? "✓" : " "} ${t.textContent}${off(t)}`,
    ),
    status: head.querySelector("span.flex-1")?.textContent ?? null,
    question: c.querySelector("p")?.textContent,
    options: [...c.querySelectorAll<HTMLButtonElement>("[role=radio],[role=checkbox]")].map(
      (b) =>
        `${b.getAttribute("aria-checked") === "true" ? "[x]" : "[ ]"} ${[...b.querySelectorAll("span")]
          .map((s) => s.textContent)
          .filter(Boolean)
          .join(" · ")}${off(b)}`,
    ),
    other: other() ? `${other().value || other().placeholder}${other().disabled ? " (disabled)" : ""}` : null,
    preview: c.querySelector("pre")?.textContent ?? null,
    actions: [skip && `Skip${off(skip)}`, send && `${send.title}${off(send)}`].filter(Boolean),
    submitError: c.querySelector('[data-testid="submit-error"]')?.textContent ?? null,
  };
};

// A settled card: its header, each row (lit ones checked), and why.
const settled = () => {
  const [head, ...rest] = [...card().children];
  return {
    head: [...head!.querySelectorAll("span,p")].map((e) => e.textContent),
    rows: rest
      .filter((e) => e.tagName === "DIV")
      .map(
        (r) =>
          `${r.querySelector("svg") ? "[x]" : "[ ]"} ${[...r.children]
            .filter((e) => e.tagName === "SPAN")
            .map((s) => s.textContent)
            .join(" · ")}`,
      ),
    reason: rest.find((e) => e.tagName === "P")?.textContent ?? null,
    controls: card().querySelectorAll("button,input").length,
  };
};

describe("a question the CLI is waiting on", () => {
  test("one question at a time: the headers are tabs, sending held until every one is answered", () => {
    render();

    expect(view()).toMatchInlineSnapshot(`
      {
        "actions": [
          "Skip",
          "Next question (disabled)",
        ],
        "options": [
          "[ ] Split hero · Copy left, shot right · 1",
          "[ ] Centered · Recommended · Headline over an image · 2",
        ],
        "other": "Or type your own answer…",
        "preview": null,
        "question": "Which layout should the hero use?",
        "status": null,
        "submitError": null,
        "tabs": [
          "> Layout",
          "  Sections",
        ],
      }
    `);
  });

  test("a single question shows its header and what Claude is doing instead of tabs", () => {
    render({ input: multi });

    expect(view()).toMatchInlineSnapshot(`
      {
        "actions": [
          "Skip",
          "Send answers (disabled)",
        ],
        "options": [
          "[ ] Pricing · Three tiers · 1",
          "[ ] FAQ · Accordion · 2",
        ],
        "other": "Add your own…",
        "preview": null,
        "question": "Which sections should follow it?Choose any",
        "status": "Claude is waiting on this",
        "submitError": null,
        "tabs": [],
      }
    `);
  });

  test("a pick stays on its question until Next; then the answered tab gets a tick", () => {
    render();

    click(button("Split hero"));
    expect(view().tabs).toEqual(["> Layout", "  Sections"]);
    expect(view().preview).toBe("[copy] [shot]");
    click(button("Next question"));

    expect(view()).toMatchInlineSnapshot(`
      {
        "actions": [
          "Skip",
          "Send answers (disabled)",
        ],
        "options": [
          "[ ] Pricing · Three tiers · 1",
          "[ ] FAQ · Accordion · 2",
        ],
        "other": "Add your own…",
        "preview": null,
        "question": "Which sections should follow it?Choose any",
        "status": null,
        "submitError": null,
        "tabs": [
          "✓ Layout",
          "> Sections",
        ],
      }
    `);
  });

  test("sends the picks in the question's own order, whatever order they were clicked", () => {
    const { onSubmit } = render();

    click(button("Split hero"));
    click(button("Sections"));
    click(button("FAQ"));
    click(button("Pricing"));
    click(button("Send answers"));

    expect(onSubmit.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "Which layout should the hero use?": "Split hero",
            "Which sections should follow it?": [
              "Pricing",
              "FAQ",
            ],
          },
        ],
      ]
    `);
  });

  test("a single-select pick replaces the last one; a multi-select pick toggles", () => {
    const { onSubmit } = render();

    click(button("Split hero"));
    click(button("Centered"));
    click(button("Sections"));
    click(button("Pricing"));
    click(button("FAQ"));
    click(button("Pricing"));
    click(button("Send answers"));

    expect(onSubmit.mock.calls[0]?.[0]).toMatchInlineSnapshot(`
      {
        "Which layout should the hero use?": "Centered (Recommended)",
        "Which sections should follow it?": [
          "FAQ",
        ],
      }
    `);
  });

  test("typing an answer picks Other: alone on single-select, alongside picks on multi-select", () => {
    const { onSubmit } = render();

    click(button("Split hero"));
    type("  Asymmetric  ");
    expect(view().options).toMatchInlineSnapshot(`
      [
        "[ ] Split hero · Copy left, shot right · 1",
        "[ ] Centered · Recommended · Headline over an image · 2",
      ]
    `);
    click(button("Sections"));
    click(button("Pricing"));
    type("Team");
    click(button("Send answers"));

    expect(onSubmit.mock.calls[0]?.[0]).toMatchInlineSnapshot(`
      {
        "Which layout should the hero use?": "Asymmetric",
        "Which sections should follow it?": [
          "Pricing",
          "Team",
        ],
      }
    `);
  });

  test("Skip declines, and so does Escape", () => {
    const { onDecline, onSubmit } = render();

    click(button("Skip"));
    act(() => {
      card().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });

    expect(onDecline).toHaveBeenCalledTimes(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a failed submit says why, and the card stays answerable", () => {
    render({ input: one, submitError: '"Which layout should the hero use?" has an empty answer.' });

    expect({ submitError: view().submitError, actions: view().actions }).toMatchInlineSnapshot(`
      {
        "actions": [
          "Skip",
          "Send answers (disabled)",
        ],
        "submitError": ""Which layout should the hero use?" has an empty answer.",
      }
    `);
  });

  test("while a submit is in flight nothing can be clicked twice", () => {
    render({ input: one, busy: true });

    expect(view()).toMatchInlineSnapshot(`
      {
        "actions": [
          "Skip (disabled)",
          "Send answers (disabled)",
        ],
        "options": [
          "[ ] Split hero · Copy left, shot right (disabled)",
          "[ ] Centered · Recommended · Headline over an image (disabled)",
        ],
        "other": "Or type your own answer… (disabled)",
        "preview": null,
        "question": "Which layout should the hero use?",
        "status": "Sending…",
        "submitError": null,
        "tabs": [],
      }
    `);
  });

  test("once it is no longer waiting, it stays sending until its result lands", () => {
    const { rerender } = render({ input: one });

    rerender({ pending: false });

    expect(view().status).toBe("Sending…");
  });
});

describe("a question the CLI is not waiting on", () => {
  test("not yet asked: the question shows, but nothing can be picked", () => {
    render({ input: one, pending: false });

    expect(view()).toMatchInlineSnapshot(`
      {
        "actions": [],
        "options": [
          "[ ] Split hero · Copy left, shot right (disabled)",
          "[ ] Centered · Recommended · Headline over an image (disabled)",
        ],
        "other": "Or type your own answer… (disabled)",
        "preview": null,
        "question": "Which layout should the hero use?",
        "status": "Question",
        "submitError": null,
        "tabs": [],
      }
    `);
  });

  test("answered: the pick stays lit, the rest dim, and nothing can be changed", () => {
    render({ input: one, pending: false, state: "output-available", answered: { [LAYOUT]: "Centered (Recommended)" } });

    expect(settled()).toMatchInlineSnapshot(`
      {
        "controls": 0,
        "head": [
          "Layout",
          "Answered",
          "Which layout should the hero use?",
        ],
        "reason": null,
        "rows": [
          "[ ] Split hero · Copy left, shot right",
          "[x] Centered · Headline over an image",
        ],
      }
    `);
  });

  test("answered on multi-select: the CLI's joined answer splits back into picks and a typed one", () => {
    render({
      input: multi,
      pending: false,
      state: "output-available",
      answered: { [SECTIONS]: 'Pricing, FAQ, "Team, careers"' },
    });

    expect(settled().rows).toMatchInlineSnapshot(`
      [
        "[x] Pricing · Three tiers",
        "[x] FAQ · Accordion",
        "[x] “Team, careers”",
      ]
    `);
  });

  test("answered, several questions: each question over its answer", () => {
    render({
      pending: false,
      state: "output-available",
      answered: { [LAYOUT]: "Centered (Recommended)", [SECTIONS]: "Pricing, FAQ" },
    });

    expect(settled()).toMatchInlineSnapshot(`
      {
        "controls": 0,
        "head": [
          "Answered · 2 questions",
        ],
        "reason": null,
        "rows": [
          "[x] Which layout should the hero use? · Centered",
          "[x] Which sections should follow it? · Pricing, FAQ",
        ],
      }
    `);
  });

  test("not answered: says which way it settled, from the deny the model read", () => {
    const why = (errorText: string) => {
      render({ input: one, pending: false, state: "output-error", errorText });
      const { head, reason } = settled();
      act(() => root?.unmount());
      return `${head[1]}: ${reason}`;
    };

    expect([
      why(DENY_MESSAGES.declined),
      why(DENY_MESSAGES.cancelled),
      why(DENY_MESSAGES.ended),
      why(DENY_MESSAGES.noHandle),
      why(DENY_MESSAGES.unreadable),
    ]).toMatchInlineSnapshot(`
      [
        "Skipped: Skipped — Claude carried on without it.",
        "Not answered: Stopped before it was answered.",
        "Not answered: The session ended before it was answered.",
        "Not shown: Couldn't be shown — Claude asked in plain text instead.",
        "Not shown: Couldn't be shown — Claude asked in plain text instead.",
      ]
    `);
  });
});

describe("the connected card", () => {
  const conversationId = "conv-1";
  const toolUseId = "toolu_ask";
  const toolPart = { type: "tool-AskUserQuestion", state: "input-available" as const, input };

  // Each call answers with the next response in line.
  const respond = (...responses: Array<[number, unknown]>) => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        const [status, body] = responses.shift()!;
        return new Response(JSON.stringify(body), { status });
      }),
    );
    return calls;
  };

  const mount = () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.conversations.pendingQuestionIds(conversationId), [toolUseId]);
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <QueryClientProvider client={queryClient}>
          <AskUserQuestion conversationId={conversationId} toolUseId={toolUseId} toolPart={toolPart} />
        </QueryClientProvider>,
      ),
    );
    return queryClient;
  };

  // Lets the mutation's fetch and its settle run.
  const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));
  const shown = () => ({ submitError: view().submitError, actions: view().actions, status: view().status });

  afterEach(() => vi.unstubAllGlobals());

  const answerBoth = () => {
    click(button("Split hero"));
    click(button("Sections"));
    click(button("Pricing"));
  };

  test("each failure replaces the last one's message; a Skip that goes through leaves it sending until its result lands", async () => {
    const calls = respond(
      [400, { error: { code: "EMPTY_ANSWER", message: '"Which layout should the hero use?" has an empty answer.' } }],
      [500, { error: { code: "INTERNAL", message: "The decline did not go through." } }],
      [200, { declined: true }],
    );
    const queryClient = mount();
    const pending = () =>
      queryClient.getQueryData(queryKeys.conversations.pendingQuestionIds(conversationId));

    answerBoth();
    click(button("Send answers"));
    await flush();
    expect(shown()).toMatchInlineSnapshot(`
      {
        "actions": [
          "Skip",
          "Send answers",
        ],
        "status": null,
        "submitError": ""Which layout should the hero use?" has an empty answer.",
      }
    `);

    // The question is still waiting, so the Skip's own failure is what shows,
    // not the Submit's from before it.
    click(button("Skip"));
    await flush();
    expect({ pending: pending(), shown: shown() }).toMatchInlineSnapshot(`
      {
        "pending": [
          "toolu_ask",
        ],
        "shown": {
          "actions": [
            "Skip",
            "Send answers",
          ],
          "status": null,
          "submitError": "The decline did not go through.",
        },
      }
    `);

    click(button("Skip"));
    await flush();
    expect({ calls, pending: pending(), shown: shown() }).toMatchInlineSnapshot(`
      {
        "calls": [
          "POST antidraw://app/api/chat/conv-1/question/toolu_ask",
          "DELETE antidraw://app/api/chat/conv-1/question/toolu_ask",
          "DELETE antidraw://app/api/chat/conv-1/question/toolu_ask",
        ],
        "pending": [],
        "shown": {
          "actions": [
            "Skip (disabled)",
            "Send answers (disabled)",
          ],
          "status": null,
          "submitError": null,
        },
      }
    `);
  });

  test("a network failure is shown too, rather than Submit doing nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    mount();

    answerBoth();
    click(button("Send answers"));
    await flush();

    expect(shown().submitError).toMatchInlineSnapshot(`"Failed to answer the question"`);
  });
});
