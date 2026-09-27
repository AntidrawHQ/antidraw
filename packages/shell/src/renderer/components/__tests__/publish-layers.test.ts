import { describe, test, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LAYER, zIndexOf } from "@/renderer/lib/layers";
import { PANEL_CLASS, TOAST_CLASS } from "../PublishButton";
import { PublishDetails } from "../PublishDetails";

// Radix portals render nothing on the server, so the dialog is replaced by
// plain elements that show the classes PublishDetails gives it.
vi.mock("@/renderer/components/ui/dialog", () => {
  const pass = ({ children }: { children?: ReactNode }) => children ?? null;
  return {
    Dialog: pass,
    DialogHeader: pass,
    DialogTitle: pass,
    DialogDescription: pass,
    DialogContent: ({
      className,
      overlayClassName,
      children,
    }: {
      className?: string;
      overlayClassName?: string;
      children?: ReactNode;
    }) =>
      createElement(
        "div",
        { "data-overlay": overlayClassName ?? "", className },
        children,
      ),
  };
});

const sidePanel = zIndexOf(LAYER.sidePanel)!;

describe("publish results are drawn above the code side panel", () => {
  test("the side panel uses the shared side panel layer", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../CodeSidePanel.tsx"),
      "utf8",
    );
    expect(source).toContain("LAYER.sidePanel");
    expect(source).not.toMatch(/\bz-(\[\d+\]|\d+)\b/);
    expect(sidePanel).toBe(100);
  });

  test("the failure / sign-in panel sits above it", () => {
    expect(zIndexOf(PANEL_CLASS)).toBeGreaterThan(sidePanel);
  });

  test("the published toast sits above it", () => {
    expect(zIndexOf(TOAST_CLASS)).toBeGreaterThan(sidePanel);
  });

  test("the Details dialog and its backdrop sit above it", () => {
    const html = renderToStaticMarkup(
      createElement(PublishDetails, {
        open: true,
        onOpenChange: () => {},
        result: {
          excluded: { listed: [], grouped: [] },
          notes: [],
          snapshot: { fileCount: 3 },
          site: { fileCount: 2, skipped: [] },
        } as unknown as Parameters<typeof PublishDetails>[0]["result"],
      }),
    );
    const content = /class="([^"]*)"/.exec(html)?.[1] ?? "";
    const overlay = /data-overlay="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(zIndexOf(content)).toBeGreaterThan(sidePanel);
    expect(zIndexOf(overlay)).toBeGreaterThan(sidePanel);
  });
});

describe("zIndexOf", () => {
  test("reads arbitrary and scale values, and ignores look-alikes", () => {
    expect(zIndexOf("fixed z-[110] flex")).toBe(110);
    expect(zIndexOf("z-50")).toBe(50);
    expect(zIndexOf("hover:bg-x fixed")).toBeNull();
    expect(zIndexOf("size-2 zoom-in-95")).toBeNull();
  });
});
