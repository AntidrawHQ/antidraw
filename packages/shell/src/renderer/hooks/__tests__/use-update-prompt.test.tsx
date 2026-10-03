// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

// The update prompt with main's API and sonner faked: when the toast shows,
// what "Later" does, how the titlebar reminder brings it back, and what a
// newer version or a late first read does.

// A toaster that keeps the toasts showing, by id, as sonner does.
type Card = ReactElement<{ version: string; onRestart: () => void; onDismiss: () => void }>;
const toaster = vi.hoisted(() => new Map<string, () => unknown>());
vi.mock("sonner", () => ({
  toast: {
    custom: (render: () => unknown, { id }: { id: string }) => toaster.set(id, render),
    dismiss: (id: string) => toaster.delete(id),
  },
}));

let push: (version: string) => void = () => {};
const electronAPI = {
  getUpdateStatus: vi.fn(),
  installUpdate: vi.fn(),
  onUpdateDownloaded: (callback: (version: string) => void) => {
    push = callback;
    return () => {};
  },
};

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { electronAPI: typeof electronAPI }).electronAPI = electronAPI;
});

let root: Root | undefined;
beforeEach(async () => {
  toaster.clear();
  electronAPI.getUpdateStatus.mockReset().mockResolvedValue({ pendingVersion: null });
  electronAPI.installUpdate.mockReset();
  const { useUpdateStore } = await import("../../store/update");
  useUpdateStore.setState({ dismissedVersion: null });
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

// React Query tells components about cache changes on a timer, so let one
// pass before looking.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
/** Does `action` as the user or main would, then lets the app settle. */
const step = async (action: () => unknown) => {
  await act(async () => void action());
  await settle();
};

/** The root's hooks plus the titlebar's reminder, as the app mounts them. */
const render = async () => {
  const { useUpdateSubscription } = await import("../use-update-status");
  const { useUpdatePrompt, useUpdateToast } = await import("../use-update-prompt");
  const { useUpdateStore } = await import("../../store/update");
  const App = () => {
    useUpdateSubscription();
    useUpdateToast();
    const { pendingVersion, showReminder } = useUpdatePrompt();
    const clearDismissal = useUpdateStore((state) => state.clearDismissal);
    return showReminder ? <button onClick={clearDismissal}>Update available {pendingVersion}</button> : null;
  };
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root!.render(<QueryClientProvider client={new QueryClient()}><App /></QueryClientProvider>));
  await settle();
};

/** The toast showing now: its id, version and buttons, or null. */
const shownToast = () => {
  if (toaster.size > 1) throw new Error(`${toaster.size} toasts are showing`);
  const [entry] = toaster;
  if (!entry) return null;
  const [id, render] = entry;
  return { id, ...(render() as Card).props };
};
const reminder = () => document.querySelector("button")?.textContent ?? null;

it("shows nothing until an update has downloaded", async () => {
  await render();
  expect({ toast: shownToast(), reminder: reminder() }).toEqual({ toast: null, reminder: null });
});

it("shows the toast for a downloaded update, and restarts into it", async () => {
  await render();
  await step(() => push("1.2.0"));
  const toast = shownToast()!;
  toast.onRestart();
  expect({ id: toast.id, version: toast.version, reminder: reminder(), installs: electronAPI.installUpdate.mock.calls.length })
    .toEqual({ id: "update-available", version: "1.2.0", reminder: null, installs: 1 });
});

it("swaps the toast for the titlebar reminder on Later, and brings it back from there", async () => {
  await render();
  await step(() => push("1.2.0"));
  await step(() => shownToast()!.onDismiss());
  const afterLater = { toast: shownToast(), reminder: reminder() };
  await step(() => (document.querySelector("button") as HTMLButtonElement).click());
  expect({ afterLater, afterReminder: { toast: shownToast()?.version, reminder: reminder() } }).toEqual({
    afterLater: { toast: null, reminder: "Update available 1.2.0" },
    afterReminder: { toast: "1.2.0", reminder: null },
  });
});

it("prompts again for a newer version after Later", async () => {
  await render();
  await step(() => push("1.2.0"));
  await step(() => shownToast()!.onDismiss());
  await step(() => push("1.3.0"));
  expect({ toast: shownToast()?.version, reminder: reminder() }).toEqual({ toast: "1.3.0", reminder: null });
});

it("keeps a version pushed while the first read was still in flight", async () => {
  let answer!: (status: { pendingVersion: string | null }) => void;
  electronAPI.getUpdateStatus.mockReturnValue(new Promise((resolve) => (answer = resolve)));
  await render();
  await step(() => push("1.2.0"));
  // Main's answer was taken before the download finished.
  await step(() => answer({ pendingVersion: null }));
  expect(shownToast()?.version).toBe("1.2.0");
});

it("asks main for an update that downloaded before the app subscribed", async () => {
  electronAPI.getUpdateStatus.mockResolvedValue({ pendingVersion: "1.2.0" });
  await render();
  expect(shownToast()?.version).toBe("1.2.0");
});
