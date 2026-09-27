import { describe, test, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountRequestError } from "@/renderer/lib/account-ops";
import { FailureContent, panelTakesFocus } from "../PublishButton";

const render = (error: AccountRequestError) =>
  renderToStaticMarkup(
    createElement(FailureContent, {
      error,
      onRetry: () => {},
      onCheckStatus: () => {},
      checking: false,
      check: null,
    }),
  );

describe("a failure panel that opens on its own does not take focus", () => {
  test("its button is not autofocused (focus is decided by panelTakesFocus)", () => {
    const html = render(new AccountRequestError("WORKSPACE_BUSY", "busy"));
    expect(html).toContain("Try again");
    expect(html).not.toMatch(/autofocus/i);
  });

  test("focus moves only from the Publish button", () => {
    const el = (children: object[] = []) => ({
      contains(other: unknown) {
        return other === this || children.includes(other as object);
      },
    });
    const publishButton = el();
    const composer = el();
    const body = el([publishButton, composer]);
    const at = (e: object) => e as unknown as Element;

    expect(panelTakesFocus(at(publishButton), at(publishButton))).toBe(true);
    expect(panelTakesFocus(at(composer), at(publishButton))).toBe(false);
    expect(panelTakesFocus(at(body), at(publishButton))).toBe(false);
    expect(panelTakesFocus(null, at(publishButton))).toBe(false);
    expect(panelTakesFocus(at(publishButton), null)).toBe(false);
  });
});

describe("a cancel after uploads started warns about public files", () => {
  test("the panel says the publish was cancelled, and that public files may be live", () => {
    const html = render(
      new AccountRequestError("CANCELLED", "Publishing was cancelled.", {
        publicFilesMayHaveChanged: true,
      }),
    );
    expect(html).toContain("Publish cancelled");
    expect(html).toContain("Some public files on your live site may already be updated");
    expect(html).toContain("Publish again");
  });
});
