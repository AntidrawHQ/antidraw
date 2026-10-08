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
import type { AskUserQuestionInput } from "@/shared/utils/ask-user-question";
import { queryKeys } from "@/renderer/lib/query-keys";

// The card in jsdom: what it shows in each state, and what it hands onSubmit
// for a given set of clicks. The connected card is covered at the end, with
// only fetch faked — what happens when the backend says no.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
        { label: "Centered", description: "Headline over an image" },
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
      />,
    ),
  );
  return { onSubmit, onDecline };
};

const card = () => document.querySelector<HTMLElement>('[data-testid="ask-user-question"]')!;

const button = (name: string, scope: ParentNode = document) => {
  const found = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.startsWith(name),
  );
  if (!found) throw new Error(`no button "${name}"`);
  return found;
};

const group = (question: string) =>
  document.querySelector<HTMLElement>(`[aria-label="${question}"]`)!;

const click = (el: HTMLElement) => act(() => el.click());

// React tracks an input's value itself; setting .value directly would be
// overwritten on the next render. The native setter plus an input event is
// what a keystroke amounts to.
const type = (question: string, text: string) => {
  const el = document.querySelector<HTMLInputElement>(
    `input[aria-label="Other answer: ${question}"]`,
  )!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

// Everything a user can see or reach, as data.
const view = () => ({
  status: card().querySelector("p")?.textContent,
  questions: [...card().querySelectorAll<HTMLElement>("[role=radiogroup],[role=group]")].map(
    (g) => ({
      question: g.getAttribute("aria-label"),
      kind: g.getAttribute("role"),
      options: [...g.querySelectorAll<HTMLButtonElement>("button")].map(
        (b) =>
          `${b.getAttribute("aria-checked") === "true" ? "[x]" : "[ ]"} ${b.querySelector("span")?.textContent ?? b.textContent}${b.disabled ? " (disabled)" : ""}`,
      ),
      preview: g.querySelector("pre")?.textContent ?? null,
    }),
  ),
  answers: [...card().querySelectorAll('[data-testid="answer"]')].map((a) => a.textContent),
  actions: ["Skip", "Submit"].flatMap((name) => {
    const b = [...card().querySelectorAll("button")].find((x) => x.textContent === name);
    return b ? [`${name}${b.disabled ? " (disabled)" : ""}`] : [];
  }),
  error: card().querySelector('[data-testid="error"]')?.textContent ?? null,
});

describe("a question the CLI is waiting on", () => {
  test("shows every question and option, with Submit held until all are answered", () => {
    render();

    expect(view()).toMatchInlineSnapshot(`
      {
        "actions": [
          "Skip",
          "Submit (disabled)",
        ],
        "answers": [],
        "error": null,
        "questions": [
          {
            "kind": "radiogroup",
            "options": [
              "[ ] Split hero",
              "[ ] Centered",
              "[ ] Other…",
            ],
            "preview": null,
            "question": "Which layout should the hero use?",
          },
          {
            "kind": "group",
            "options": [
              "[ ] Pricing",
              "[ ] FAQ",
              "[ ] Other…",
            ],
            "preview": null,
            "question": "Which sections should follow it?",
          },
        ],
        "status": "Claude is asking",
      }
    `);
  });

  test("submits the picks in the question's own order, whatever order they were clicked", () => {
    const { onSubmit } = render();

    click(button("Split hero", group(LAYOUT)));
    click(button("FAQ", group(SECTIONS)));
    click(button("Pricing", group(SECTIONS)));
    expect(view()).toMatchInlineSnapshot(`
      {
        "actions": [
          "Skip",
          "Submit",
        ],
        "answers": [],
        "error": null,
        "questions": [
          {
            "kind": "radiogroup",
            "options": [
              "[x] Split hero",
              "[ ] Centered",
              "[ ] Other…",
            ],
            "preview": "[copy] [shot]",
            "question": "Which layout should the hero use?",
          },
          {
            "kind": "group",
            "options": [
              "[x] Pricing",
              "[x] FAQ",
              "[ ] Other…",
            ],
            "preview": null,
            "question": "Which sections should follow it?",
          },
        ],
        "status": "Claude is asking",
      }
    `);

    click(button("Submit"));
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

    click(button("Split hero", group(LAYOUT)));
    click(button("Centered", group(LAYOUT)));
    click(button("Pricing", group(SECTIONS)));
    click(button("FAQ", group(SECTIONS)));
    click(button("Pricing", group(SECTIONS)));
    click(button("Submit"));

    expect(onSubmit.mock.calls[0]?.[0]).toMatchInlineSnapshot(`
      {
        "Which layout should the hero use?": "Centered",
        "Which sections should follow it?": [
          "FAQ",
        ],
      }
    `);
  });

  test("Other takes a typed answer, alone on single-select and alongside picks on multi-select", () => {
    const { onSubmit } = render();

    click(button("Split hero", group(LAYOUT)));
    click(button("Other", group(LAYOUT)));
    click(button("Pricing", group(SECTIONS)));
    click(button("Other", group(SECTIONS)));
    // Picked but still blank: not an answer yet.
    expect(button("Submit").disabled).toBe(true);

    type(LAYOUT, "  Asymmetric  ");
    type(SECTIONS, "Team");
    click(button("Submit"));

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

  test("Skip declines", () => {
    const { onDecline, onSubmit } = render();

    click(button("Skip"));

    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("a failed submit says why, and the card stays answerable", () => {
    render({ submitError: '"Which layout should the hero use?" has an empty answer.' });

    expect({
      submitError: card().querySelector('[data-testid="submit-error"]')?.textContent,
      actions: view().actions,
    }).toMatchInlineSnapshot(`
      {
        "actions": [
          "Skip",
          "Submit (disabled)",
        ],
        "submitError": ""Which layout should the hero use?" has an empty answer.",
      }
    `);
  });

  test("while a submit is in flight nothing can be clicked twice", () => {
    render({ busy: true });

    expect(view().actions).toMatchInlineSnapshot(`
      [
        "Skip (disabled)",
        "Submit (disabled)",
      ]
    `);
    expect(view().questions[0]?.options[0]).toMatchInlineSnapshot(`"[ ] Split hero (disabled)"`);
  });
});

describe("a question the CLI is not waiting on", () => {
  test("answered: shows what the tool ran with, and no controls", () => {
    render({
      pending: false,
      state: "output-available",
      answered: { [LAYOUT]: "Centered", [SECTIONS]: "Pricing, FAQ" },
    });

    expect(view()).toMatchInlineSnapshot(`
      {
        "actions": [],
        "answers": [
          "Centered",
          "Pricing, FAQ",
        ],
        "error": null,
        "questions": [],
        "status": "Answered",
      }
    `);
  });

  test("declined, stopped or ended: says so and shows why", () => {
    render({
      pending: false,
      state: "output-error",
      errorText: "The user declined to answer.",
    });

    expect(view()).toMatchInlineSnapshot(`
      {
        "actions": [],
        "answers": [],
        "error": "The user declined to answer.",
        "questions": [
          {
            "kind": "radiogroup",
            "options": [
              "[ ] Split hero (disabled)",
              "[ ] Centered (disabled)",
              "[ ] Other… (disabled)",
            ],
            "preview": null,
            "question": "Which layout should the hero use?",
          },
          {
            "kind": "group",
            "options": [
              "[ ] Pricing (disabled)",
              "[ ] FAQ (disabled)",
              "[ ] Other… (disabled)",
            ],
            "preview": null,
            "question": "Which sections should follow it?",
          },
        ],
        "status": "Not answered",
      }
    `);
  });

  test("not yet asked: the question shows, but nothing can be picked", () => {
    render({ pending: false });

    expect(view()).toMatchInlineSnapshot(`
      {
        "actions": [],
        "answers": [],
        "error": null,
        "questions": [
          {
            "kind": "radiogroup",
            "options": [
              "[ ] Split hero (disabled)",
              "[ ] Centered (disabled)",
              "[ ] Other… (disabled)",
            ],
            "preview": null,
            "question": "Which layout should the hero use?",
          },
          {
            "kind": "group",
            "options": [
              "[ ] Pricing (disabled)",
              "[ ] FAQ (disabled)",
              "[ ] Other… (disabled)",
            ],
            "preview": null,
            "question": "Which sections should follow it?",
          },
        ],
        "status": "Question",
      }
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
  const shown = () => ({
    submitError: card().querySelector('[data-testid="submit-error"]')?.textContent ?? null,
    actions: view().actions,
  });

  afterEach(() => vi.unstubAllGlobals());

  test("each failure replaces the last one's message; a Skip that goes through takes the question down", async () => {
    const calls = respond(
      [400, { error: { code: "EMPTY_ANSWER", message: '"Which layout should the hero use?" has an empty answer.' } }],
      [500, { error: { code: "INTERNAL", message: "The decline did not go through." } }],
      [200, { declined: true }],
    );
    const queryClient = mount();
    const pending = () =>
      queryClient.getQueryData(queryKeys.conversations.pendingQuestionIds(conversationId));

    click(button("Split hero"));
    click(button("Pricing"));
    click(button("Submit"));
    await flush();
    expect(shown()).toMatchInlineSnapshot(`
      {
        "actions": [
          "Skip",
          "Submit",
        ],
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
            "Submit",
          ],
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
          "actions": [],
          "submitError": null,
        },
      }
    `);
  });

  test("a network failure is shown too, rather than Submit doing nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    mount();

    click(button("Split hero"));
    click(button("Pricing"));
    click(button("Submit"));
    await flush();

    expect(shown().submitError).toMatchInlineSnapshot(`"Failed to answer the question"`);
  });
});
