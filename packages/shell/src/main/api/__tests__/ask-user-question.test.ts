import { describe, test, expect, afterEach } from "vitest";
import { buildPrompt } from "@/main/api/claude-code-ops";
import {
  answerQuestion,
  buildAnswer,
  createCanUseTool,
  declineQuestion,
} from "@/main/api/ask-user-question";
import {
  getPendingQuestionIds,
  openHandle,
  releaseHandle,
  subscribe,
} from "@/main/lib/conversation-store";

// An input the way the model writes one, with a field we do not read
// (metadata) to prove it comes back untouched.
const input = () => ({
  questions: [
    {
      question: "Which layout should the hero use?",
      header: "Layout",
      multiSelect: false,
      options: [
        { label: "Split hero", description: "Copy left, shot right" },
        { label: "Centered", description: "Headline over an image" },
      ],
    },
    {
      question: "Which sections should follow it?",
      header: "Sections",
      multiSelect: true,
      options: [
        { label: "Pricing", description: "Three tiers" },
        { label: "FAQ", description: "Accordion" },
        { label: "Logos, quotes", description: "Social proof" },
      ],
    },
  ],
  metadata: { source: "test" },
});

const LAYOUT = "Which layout should the hero use?";
const SECTIONS = "Which sections should follow it?";

describe("buildAnswer", () => {
  test("adds answers and leaves every other field as it was", () => {
    const result = buildAnswer(input(), {
      [LAYOUT]: "Split hero",
      [SECTIONS]: ["Pricing", "FAQ"],
    });

    expect(result._unsafeUnwrap()).toMatchInlineSnapshot(`
      {
        "answers": {
          "Which layout should the hero use?": "Split hero",
          "Which sections should follow it?": "Pricing, FAQ",
        },
        "metadata": {
          "source": "test",
        },
        "questions": [
          {
            "header": "Layout",
            "multiSelect": false,
            "options": [
              {
                "description": "Copy left, shot right",
                "label": "Split hero",
              },
              {
                "description": "Headline over an image",
                "label": "Centered",
              },
            ],
            "question": "Which layout should the hero use?",
          },
          {
            "header": "Sections",
            "multiSelect": true,
            "options": [
              {
                "description": "Three tiers",
                "label": "Pricing",
              },
              {
                "description": "Accordion",
                "label": "FAQ",
              },
              {
                "description": "Social proof",
                "label": "Logos, quotes",
              },
            ],
            "question": "Which sections should follow it?",
          },
        ],
      }
    `);
  });

  test("a multi-select answer is joined the CLI's way, quoting what would split", () => {
    const result = buildAnswer(input(), {
      [LAYOUT]: "Centered",
      [SECTIONS]: ["Logos, quotes", 'A "testimonial" wall', "FAQ"],
    });

    expect(result._unsafeUnwrap().answers).toMatchInlineSnapshot(`
      {
        "Which layout should the hero use?": "Centered",
        "Which sections should follow it?": ""Logos, quotes", "A \\"testimonial\\" wall", FAQ",
      }
    `);
  });

  test("a typed answer goes through as written", () => {
    const result = buildAnswer(input(), {
      [LAYOUT]: "Asymmetric, image bleeding off the right edge",
      [SECTIONS]: ["Pricing"],
    });

    expect(result._unsafeUnwrap().answers).toMatchInlineSnapshot(`
      {
        "Which layout should the hero use?": "Asymmetric, image bleeding off the right edge",
        "Which sections should follow it?": "Pricing",
      }
    `);
  });

  test("answers that do not fit the question are refused with a reason", () => {
    const refusals = {
      unknownQuestion: buildAnswer(input(), {
        [LAYOUT]: "Centered",
        [SECTIONS]: "FAQ",
        "Which font?": "Inter",
      }),
      missingAnswer: buildAnswer(input(), { [LAYOUT]: "Centered" }),
      emptyString: buildAnswer(input(), { [LAYOUT]: "  ", [SECTIONS]: "FAQ" }),
      emptyList: buildAnswer(input(), { [LAYOUT]: "Centered", [SECTIONS]: [] }),
      listOnSingleSelect: buildAnswer(input(), {
        [LAYOUT]: ["Centered", "Split hero"],
        [SECTIONS]: "FAQ",
      }),
      tooMany: buildAnswer(input(), {
        [LAYOUT]: "Centered",
        [SECTIONS]: ["Pricing", "FAQ", "Logos, quotes", "Team", "Blog"],
      }),
      notAQuestionInput: buildAnswer({ command: "ls" }, {}),
    };

    expect(
      Object.fromEntries(
        Object.entries(refusals).map(([k, r]) => [k, r._unsafeUnwrapErr()]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "emptyList": {
          "code": "EMPTY_ANSWER",
          "message": ""Which sections should follow it?" has an empty answer.",
        },
        "emptyString": {
          "code": "EMPTY_ANSWER",
          "message": ""Which layout should the hero use?" has an empty answer.",
        },
        "listOnSingleSelect": {
          "code": "NOT_MULTI_SELECT",
          "message": ""Which layout should the hero use?" takes one answer.",
        },
        "missingAnswer": {
          "code": "MISSING_ANSWER",
          "message": ""Which sections should follow it?" has no answer.",
        },
        "notAQuestionInput": {
          "code": "INVALID_INPUT",
          "message": "The question's input is not an AskUserQuestion input.",
        },
        "tooMany": {
          "code": "TOO_MANY_ANSWERS",
          "message": ""Which sections should follow it?" has more answers than options.",
        },
        "unknownQuestion": {
          "code": "UNKNOWN_QUESTION",
          "message": "No question reads "Which font?".",
        },
      }
    `);
  });
});

// The callback as the SDK calls it: tool name, input, and the options bag.
const call = (
  conversationId: string,
  toolName: string,
  toolUseID: string,
  signal = new AbortController().signal,
) =>
  createCanUseTool(conversationId)(toolName, input(), {
    signal,
    toolUseID,
    requestId: `req-${toolUseID}`,
  });

let counter = 0;
const liveConversation = () => {
  const id = `ask-${counter++}`;
  openHandle(id, buildPrompt("hello", { uuid: crypto.randomUUID() }));
  return id;
};

const detach: Array<() => void> = [];
afterEach(() => detach.splice(0).forEach((off) => off()));

const watch = (conversationId: string) => {
  const questions: string[][] = [];
  detach.push(
    subscribe(conversationId, (event) => {
      if (event.type === "questions") questions.push(event.toolUseIds);
    }),
  );
  return questions;
};

// Whether a promise has settled yet, without waiting on it.
const peek = async <T,>(p: Promise<T>) => {
  const pending = Symbol("pending");
  const winner = await Promise.race([p, Promise.resolve(pending)]);
  return winner === pending ? "pending" : winner;
};

describe("createCanUseTool", () => {
  test("any other tool is denied outright and nothing is parked", async () => {
    const id = liveConversation();
    const questions = watch(id);

    const result = await call(id, "Bash", "toolu_bash");

    expect(result).toMatchInlineSnapshot(`
      {
        "behavior": "deny",
        "message": "Bash needs the user's approval, and antidraw has no prompt for it. Do not retry; continue without it or ask the user in plain text.",
      }
    `);
    expect(questions).toEqual([]);
    releaseHandle(id);
  });

  test("AskUserQuestion parks until answered, then allows with the answers added", async () => {
    const id = liveConversation();
    const questions = watch(id);

    const asked = call(id, "AskUserQuestion", "toolu_ask");
    expect(await peek(asked)).toBe("pending");
    expect(getPendingQuestionIds(id)).toEqual(["toolu_ask"]);

    const answered = answerQuestion(id, "toolu_ask", {
      [LAYOUT]: "Split hero",
      [SECTIONS]: ["FAQ"],
    });
    expect(answered.isOk()).toBe(true);

    expect(await asked).toMatchInlineSnapshot(`
      {
        "behavior": "allow",
        "updatedInput": {
          "answers": {
            "Which layout should the hero use?": "Split hero",
            "Which sections should follow it?": "FAQ",
          },
          "metadata": {
            "source": "test",
          },
          "questions": [
            {
              "header": "Layout",
              "multiSelect": false,
              "options": [
                {
                  "description": "Copy left, shot right",
                  "label": "Split hero",
                },
                {
                  "description": "Headline over an image",
                  "label": "Centered",
                },
              ],
              "question": "Which layout should the hero use?",
            },
            {
              "header": "Sections",
              "multiSelect": true,
              "options": [
                {
                  "description": "Three tiers",
                  "label": "Pricing",
                },
                {
                  "description": "Accordion",
                  "label": "FAQ",
                },
                {
                  "description": "Social proof",
                  "label": "Logos, quotes",
                },
              ],
              "question": "Which sections should follow it?",
            },
          ],
        },
      }
    `);
    expect(questions).toMatchInlineSnapshot(`
      [
        [
          "toolu_ask",
        ],
        [],
      ]
    `);
    releaseHandle(id);
  });

  test("a bad answer is refused and the question keeps waiting", async () => {
    const id = liveConversation();
    const asked = call(id, "AskUserQuestion", "toolu_ask");

    const refused = answerQuestion(id, "toolu_ask", { [LAYOUT]: "Centered" });

    expect(refused._unsafeUnwrapErr()).toMatchInlineSnapshot(`
      {
        "code": "MISSING_ANSWER",
        "message": ""Which sections should follow it?" has no answer.",
        "status": 400,
      }
    `);
    expect(await peek(asked)).toBe("pending");
    expect(getPendingQuestionIds(id)).toEqual(["toolu_ask"]);
    declineQuestion(id, "toolu_ask");
    await asked;
    releaseHandle(id);
  });

  test("declining denies, so the model hears the user passed", async () => {
    const id = liveConversation();
    const asked = call(id, "AskUserQuestion", "toolu_ask");

    expect(declineQuestion(id, "toolu_ask")).toBe(true);

    expect(await asked).toMatchInlineSnapshot(`
      {
        "behavior": "deny",
        "message": "The user declined to answer. Continue without their input, or ask in plain text.",
      }
    `);
    expect(getPendingQuestionIds(id)).toEqual([]);
    releaseHandle(id);
  });

  test("Stop aborts the signal, which denies and takes the question down", async () => {
    const id = liveConversation();
    const questions = watch(id);
    const abort = new AbortController();
    const asked = call(id, "AskUserQuestion", "toolu_ask", abort.signal);

    abort.abort();

    expect(await asked).toMatchInlineSnapshot(`
      {
        "behavior": "deny",
        "message": "The user stopped the turn before answering.",
      }
    `);
    expect(questions).toEqual([["toolu_ask"], []]);
    releaseHandle(id);
  });

  test("an already-aborted signal never parks", async () => {
    const id = liveConversation();
    const questions = watch(id);
    const abort = new AbortController();
    abort.abort();

    const result = await call(id, "AskUserQuestion", "toolu_ask", abort.signal);

    expect(result?.behavior).toBe("deny");
    expect(questions).toEqual([]);
    releaseHandle(id);
  });

  test("with no handle to hold it, the question is denied at once rather than hung", async () => {
    const result = await call(`ask-${counter++}`, "AskUserQuestion", "toolu_ask");

    expect(result).toMatchInlineSnapshot(`
      {
        "behavior": "deny",
        "message": "The question could not be shown to the user.",
      }
    `);
  });

  test("an answer after the question settled is a 404, and changes nothing", async () => {
    const id = liveConversation();
    const asked = call(id, "AskUserQuestion", "toolu_ask");

    declineQuestion(id, "toolu_ask");
    const late = answerQuestion(id, "toolu_ask", {
      [LAYOUT]: "Centered",
      [SECTIONS]: "FAQ",
    });

    expect(late._unsafeUnwrapErr()).toMatchInlineSnapshot(`
      {
        "code": "NOT_PENDING",
        "message": "No question is waiting under that id.",
        "status": 404,
      }
    `);
    expect(declineQuestion(id, "toolu_ask")).toBe(false);
    // The decline is what the CLI got; the late answer never reached it.
    expect((await asked)?.behavior).toBe("deny");
    releaseHandle(id);
  });

  test("two questions in one turn are tracked apart", async () => {
    const id = liveConversation();
    const first = call(id, "AskUserQuestion", "toolu_1");
    const second = call(id, "AskUserQuestion", "toolu_2");
    expect(getPendingQuestionIds(id)).toEqual(["toolu_1", "toolu_2"]);

    declineQuestion(id, "toolu_2");
    expect(await peek(first)).toBe("pending");
    expect((await second)?.behavior).toBe("deny");

    answerQuestion(id, "toolu_1", { [LAYOUT]: "Centered", [SECTIONS]: "FAQ" });
    expect((await first)?.behavior).toBe("allow");
    releaseHandle(id);
  });
});
