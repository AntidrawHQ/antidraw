import { describe, test, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountRequestError } from "@/renderer/lib/account-ops";
import {
  FailureContent,
  PublishingLabel,
  isStillFinishing,
  panelDismisses,
  panelTakesFocus,
  publishClickAction,
  publishingAnnouncement,
  publishingName,
} from "../PublishButton";

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

describe("a failure after uploads started", () => {
  test("says only what failed: the live site is never touched before commit", () => {
    const html = render(new AccountRequestError("UPLOAD_FAILED", "Upload of logo.png failed (403)"));
    expect(html).toContain("Couldn&#x27;t publish");
    expect(html).toContain("Upload of logo.png failed (403)");
    expect(html).toContain("Try again");
    expect(html).not.toMatch(/public files|live site/i);
  });

  test("a too-large site shows its size", () => {
    const html = render(
      new AccountRequestError("SITE_TOO_LARGE", "The built site is too large to publish.", {
        siteBytes: 600 * 1024 * 1024,
        siteFileCount: 12,
      }),
    );
    expect(html).toContain("in 12 files");
  });
});

describe("a click on the titlebar button", () => {
  test("while publishing, it cancels only when cancel is offered", () => {
    expect(publishClickAction(true, true, 1)).toBe("cancel");
    expect(publishClickAction(true, true, 0)).toBe("cancel");
    expect(publishClickAction(true, false, 1)).toBe("none");
    expect(publishClickAction(true, false, 2)).toBe("none");
  });

  test("a single click or a keyboard press starts a publish", () => {
    expect(publishClickAction(false, false, 1)).toBe("start");
    expect(publishClickAction(false, false, 0)).toBe("start");
  });

  test("the second click of a double-click on Cancel does not start a publish", () => {
    // Click 1 cancelled; the run is gone before click 2 lands on "Publish".
    expect(publishClickAction(true, true, 1)).toBe("cancel");
    expect(publishClickAction(false, false, 2)).toBe("none");
    expect(publishClickAction(false, false, 3)).toBe("none");
  });
});

describe("the publishing label keeps the progress for keyboard users", () => {
  const spans = (canCancel: boolean) => {
    const html = renderToStaticMarkup(
      createElement(PublishingLabel, { label: "Uploading 42%", canCancel }),
    );
    // The outer grid span, then the progress span, then (if offered) Cancel.
    const classes = [...html.matchAll(/<span class="([^"]*)"/g)].map((m) => m[1]);
    return { html, progress: classes[1], cancel: classes[2] };
  };

  test("focus does not hide the progress or show Cancel; hover does", () => {
    const { html, progress, cancel } = spans(true);
    expect(html).toContain("Uploading 42%");
    expect(html).toContain("Cancel");
    expect(progress).toContain("group-hover:invisible");
    expect(progress).not.toContain("group-focus-visible:invisible");
    expect(cancel).toContain("group-hover:visible");
    expect(cancel).not.toContain("group-focus-visible:visible");
  });

  test("focus swaps the spinner for an X that says the button cancels", () => {
    const { html } = spans(true);
    expect(html).toMatch(/animate-spin[^"]*group-focus-visible:hidden/);
    expect(html).toMatch(/hidden group-focus-visible:block/);
  });

  test("without cancel, there is no Cancel label and no swap", () => {
    const { html } = spans(false);
    expect(html).not.toContain("Cancel");
    expect(html).not.toContain("group-focus-visible");
    expect(html).not.toContain("group-hover");
  });

  test("the accessible name carries the progress, and cancel when offered", () => {
    expect(publishingName("Uploading 42%", true)).toBe("Uploading 42%. Activate to cancel");
    expect(publishingName("Finishing", false)).toBe("Finishing");
  });

  test("the live region announces steps, not every percent", () => {
    expect(publishingAnnouncement({ step: "uploading", percent: 42 }, false)).toBe("Uploading");
    expect(publishingAnnouncement({ step: "building", percent: null }, false)).toBe("Building");
    expect(publishingAnnouncement({ step: "checking", percent: null }, false)).toBe("Publishing");
    expect(publishingAnnouncement({ step: "uploading", percent: 42 }, true)).toBe(
      "Cancelling publish",
    );
  });
});

describe("a 'Still finishing' panel", () => {
  const unknown = new AccountRequestError("PUBLISH_OUTCOME_UNKNOWN", "The publish may still finish.", {
    publishId: "pub_9",
  });

  test("is still finishing until the session is known to have ended", () => {
    expect(isStillFinishing(unknown, null)).toBe(true);
    expect(isStillFinishing(unknown, "pending")).toBe(true);
    expect(isStillFinishing(unknown, "failed")).toBe(true);
    expect(isStillFinishing(unknown, "ended")).toBe(false);
    expect(isStillFinishing(new AccountRequestError("UPLOAD_FAILED", "x"), null)).toBe(false);
  });

  test("a click outside it or an Escape elsewhere does not close it", () => {
    expect(panelDismisses("backdrop", true, false)).toBe(false);
    expect(panelDismisses("escape", true, false)).toBe(false);
    expect(panelDismisses("escape", true, true)).toBe(true);
    // Other panels close on both, as before.
    expect(panelDismisses("backdrop", false, false)).toBe(true);
    expect(panelDismisses("escape", false, false)).toBe(true);
  });

  test("says it keeps trying in the background", () => {
    const html = render(unknown);
    expect(html).toContain("Still finishing");
    expect(html).toContain("keeps trying in the background");
    expect(html).toContain("Check status");
  });
});
