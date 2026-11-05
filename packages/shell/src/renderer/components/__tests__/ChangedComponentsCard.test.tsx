// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ChangedComponents,
  ChangedComponentsCard,
  type ChangedComponentsCardProps,
} from "../ChangedComponentsCard";
import type { ToolPart } from "@/renderer/components/ui/tool";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { queryKeys } from "@/renderer/lib/query-keys";
import { REPORT_CHANGES_TOOL } from "@/shared/utils/changed-components";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const mount = (node: React.ReactNode) => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
};

const render = (props: Partial<ChangedComponentsCardProps> = {}) => {
  const onView = vi.fn();
  const host = mount(
    <ChangedComponentsCard
      created={["FaqAccordion", "PlanCompareTable"]}
      updated={["PricingPage", "PricingTier", "PricingFooter"]}
      onView={onView}
      {...props}
    />,
  );
  return { host, onView };
};

// What the card shows, as data: the header, then each section's rows.
const view = (host: HTMLElement) => {
  const header = host.querySelector<HTMLButtonElement>("button[aria-expanded]");
  if (!header) return null;
  return {
    header: `${header.textContent} (${header.getAttribute("aria-expanded") === "true" ? "open" : "closed"})`,
    sections: [...host.querySelectorAll("section")].map((s) => ({
      title: s.querySelector("h3")?.textContent,
      rows: [...s.querySelectorAll("button")].map((b) => `${b.parentElement?.textContent?.replace(/View$/, "")} · ${b.title}`),
    })),
  };
};

const click = (el: HTMLElement) => act(() => el.click());

describe("ChangedComponentsCard", () => {
  test("lists the new and updated components under a summary", () => {
    const { host } = render();
    expect(view(host)).toMatchInlineSnapshot(`
      {
        "header": "Changes2 new · 3 updated (open)",
        "sections": [
          {
            "rows": [
              "FaqAccordion · View FaqAccordion",
              "PlanCompareTable · View PlanCompareTable",
            ],
            "title": "New components",
          },
          {
            "rows": [
              "PricingPage · View PricingPage",
              "PricingTier · View PricingTier",
              "PricingFooter · View PricingFooter",
            ],
            "title": "Updated components",
          },
        ],
      }
    `);
  });

  test("View focuses that component", () => {
    const { host, onView } = render();
    click(host.querySelector<HTMLButtonElement>('button[title="View PricingTier"]')!);
    expect(onView).toHaveBeenCalledExactlyOnceWith("PricingTier");
  });

  test("the header collapses and reopens it", () => {
    const { host } = render();
    const header = host.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    click(header);
    expect(view(host)).toEqual({ header: "Changes2 new · 3 updated (closed)", sections: [] });
    click(header);
    expect(view(host)?.sections).toHaveLength(2);
  });

  test("starts collapsed with defaultOpen false", () => {
    const { host } = render({ defaultOpen: false });
    expect(view(host)?.header).toBe("Changes2 new · 3 updated (closed)");
  });

  test("leaves out an empty section, and its part of the summary", () => {
    expect(view(render({ created: [] }).host)?.header).toBe("Changes3 updated (open)");
    act(() => root?.unmount());
    const { host } = render({ updated: [] });
    expect(view(host)?.header).toBe("Changes2 new (open)");
    expect(view(host)?.sections.map((s) => s.title)).toEqual(["New components"]);
  });

  test("renders nothing with nothing to list", () => {
    expect(render({ created: [], updated: [] }).host.innerHTML).toBe("");
  });
});

describe("ChangedComponents (connected)", () => {
  const WS = "ws-1";
  const done = (input: unknown, state: ToolPart["state"] = "output-available"): ToolPart => ({
    type: REPORT_CHANGES_TOOL,
    state,
    input: input as Record<string, unknown>,
    ...(state === "output-error" ? { errorText: "Not components: Nope." } : {}),
  });

  const connected = (toolPart: ToolPart, onCanvas = ["FaqAccordion", "PricingPage", "PricingTier"]) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(queryKeys.userComponents.byWorkspace(WS), onCanvas.map((name) => ({ name })));
    useWorkspaceStore.setState({ activeWorkspaceId: WS, focusComponentName: null });
    return mount(
      <QueryClientProvider client={client}>
        <ChangedComponents toolPart={toolPart} />
      </QueryClientProvider>,
    );
  };

  test("lists only what is still on the canvas, each name once", () => {
    const host = connected(
      done({ created: ["FaqAccordion", "Deleted", "FaqAccordion"], updated: ["PricingPage", "FaqAccordion", "PricingTier"] }),
    );
    expect(view(host)?.header).toBe("Changes1 new · 2 updated (open)");
    expect(view(host)?.sections.flatMap((s) => s.rows)).toEqual([
      "FaqAccordion · View FaqAccordion",
      "PricingPage · View PricingPage",
      "PricingTier · View PricingTier",
    ]);
  });

  test("View focuses the component on the canvas", () => {
    const host = connected(done({ created: ["FaqAccordion"], updated: [] }));
    click(host.querySelector<HTMLButtonElement>('button[title="View FaqAccordion"]')!);
    expect(useWorkspaceStore.getState().focusComponentName).toBe("FaqAccordion");
  });

  test("shows nothing while the call runs", () => {
    expect(connected(done({ created: ["FaqAccordion"], updated: [] }, "input-available")).innerHTML).toBe("");
    act(() => root?.unmount());
    expect(connected(done({ created: ["FaqAccordion"] }, "input-streaming")).innerHTML).toBe("");
  });

  test("a failed call is a tool row, so its error stays visible", () => {
    const host = connected(done({ created: ["Nope"], updated: [] }, "output-error"));
    expect(host.textContent).toContain("Report changes");
    expect(host.textContent).toContain("Failed");
    expect(host.querySelector("section")).toBeNull();
  });

  test("everything gone from the canvas renders nothing", () => {
    expect(connected(done({ created: ["Deleted"], updated: [] }), []).innerHTML).toBe("");
  });
});
