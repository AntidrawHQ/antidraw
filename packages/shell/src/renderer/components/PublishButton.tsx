import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popover as PopoverPrimitive } from "radix-ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, X } from "lucide-react";
import type { Account } from "@/main/api";
import antidrawIcon from "@/renderer/assets/antidraw-icon.svg";
import { AccountRequestError, useAccount, useCancelSignIn, useSignIn } from "@/renderer/lib/account-ops";
import { queryKeys } from "@/renderer/lib/query-keys";
import { formatRelativeTime } from "@/renderer/lib/time-utils";
import { CoversCanvas } from "@/renderer/lib/thumbnail";
import { useComposerModel } from "@/renderer/hooks/use-composer-model";
import { useSendToChat } from "@/renderer/hooks/use-send-to-chat";
import {
  beginPublish,
  clearPublish,
  failPublish,
  isCurrentRun,
  isRunning,
  runPublish,
  setPublishMeta,
  setSentToAgent,
  usePublishStore,
} from "@/renderer/store/publish";
import PublishPanel from "./publish/PublishPanel";
import PublishTitlebarButton, { type ButtonMode } from "./publish/PublishTitlebarButton";
import { EXIT, SPRING, type PublishState } from "./publish/shared";

/* ────────────────────────────────────────────────────────────
   Publish button for the titlebar, and the panel under it.

   Publish opens a confirm view (where the site goes, who can see
   it); its Publish starts the run, which the panel shows step by
   step (store/publish.ts) until the site is live or a step fails.
   Signed out, the confirm view gives way to a minimal sign-in
   panel: Antidraw icon, one-line title, a single "Sign in with
   Google" button that carries every state. Once signed in, the run
   picks up in the publish panel.

   Both are one modal Radix popover: it traps focus, gives it back
   to the Publish button on close, and takes Escape only when it's
   the topmost layer. It can't be closed while publishing.
   ──────────────────────────────────────────────────────────── */

const GREEN = "oklch(0.696 0.17 162.48)";
const RED = "oklch(0.704 0.191 22.216)";

// How long "Connected" shows before publishing starts.
const LINKED_BEAT_MS = 500;

type Panel = "publish" | "signin";

type SignInStep = "signin" | "waiting" | "error";

const problem = (code: string) => {
  switch (code) {
    case "SERVER_UNREACHABLE":
      return "Couldn't reach Antidraw. Check your connection and try again.";
    case "TIMED_OUT":
      return "Sign-in timed out. Try again.";
    case "ACCESS_DENIED":
      return "Sign-in was declined in Google.";
    default:
      return "Something went wrong. Try again.";
  }
};

const lastPublished = (at: Date | string | number | null | undefined) => {
  if (!at) return undefined;
  const ago = formatRelativeTime(new Date(at));
  return ago === "now" ? "just now" : `${ago} ago`;
};

// The message the agent gets for a build that failed, in a new chat.
const fixBuildPrompt = (name: string, error: string) =>
  [
    `Publishing ${name} failed: \`vite build\` couldn't build the workspace. Fix the error so the site builds.`,
    "",
    "```",
    error,
    "```",
  ].join("\n");

function GoogleG({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="shrink-0" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

export const PublishButton = ({
  workspaceId,
  workspaceName,
  siteUrl = null,
  publishedAt = null,
}: {
  workspaceId: string;
  workspaceName: string;
  siteUrl?: string | null;
  publishedAt?: Date | string | number | null;
}) => {
  const reduce = !!useReducedMotion();
  const queryClient = useQueryClient();
  const [panel, setPanelState] = useState<Panel | null>(null);
  const [signInStep, setSignInStepState] = useState<SignInStep>("signin");
  const [linked, setLinkedState] = useState(false); // brief green beat before the run starts
  // Why sign-in failed.
  const [signInError, setSignInError] = useState<string | null>(null);
  // Counts failures, so the same message is announced again on a retry.
  const [attempt, setAttempt] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const publishButton = useRef<HTMLButtonElement>(null);
  const signInButton = useRef<HTMLButtonElement>(null);
  const run = usePublishStore((s) => s.runs[workspaceId]);

  // Live copies of the state, for guards and callbacks that run from an old
  // render: a mutation callback, or the panel while it animates out (it keeps
  // its last handlers and can still take a click, Enter or Escape). Each is
  // set together with its state, so a second click in the same frame already
  // sees the first.
  const panelRef = useRef(panel);
  const signInStepRef = useRef(signInStep);
  const linkedRef = useRef(linked);
  const setPanel = (next: Panel | null) => {
    panelRef.current = next;
    setPanelState(next);
  };
  const setSignInStep = (next: SignInStep) => {
    signInStepRef.current = next;
    setSignInStepState(next);
  };
  const setLinked = (next: boolean) => {
    linkedRef.current = next;
    setLinkedState(next);
  };
  // The workspace a publish is for: the active one can change while the
  // account is checked or the user signs in.
  const target = useRef({ id: workspaceId, name: workspaceName });
  const site = (): PublishState["site"] => ({
    name: workspaceName,
    url: siteUrl,
    lastPublished: lastPublished(publishedAt),
  });

  const { refetch: refetchAccount } = useAccount();
  const signInMutation = useSignIn();
  const cancelSignInMutation = useCancelSignIn();
  const sendToChat = useSendToChat();
  const composer = useComposerModel(null, undefined);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  const publishing = () => isRunning(usePublishStore.getState().runs[target.current.id]);
  // Whether the open panel may close (its Close button), and whether Escape
  // or a click outside closes it: not while waiting for Google, which
  // includes the Connected beat.
  const canClose = () => (panelRef.current === "publish" ? !publishing() : panelRef.current === "signin");
  const canDismiss = () => canClose() && !(panelRef.current === "signin" && signInStepRef.current === "waiting");
  const canAct = () =>
    panelRef.current === "signin" && (signInStepRef.current === "signin" || signInStepRef.current === "error");

  const openSignIn = () => {
    setSignInError(null);
    setLinked(false);
    setSignInStep("signin");
    setPanel("signin");
  };

  // Main's publish, once the account is known.
  const publish = async (ws: { id: string }, id: number, account: Account) => {
    setPublishMeta(ws.id, id, "account", account.email.split("@")[0]!);
    const ended = await runPublish(ws.id, id);
    if (ended === "done") void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
    if (ended === "signed-out") {
      // The stored token died; main already dropped it.
      queryClient.setQueryData(queryKeys.account, null);
      clearPublish(ws.id);
      if (panelRef.current === "publish" && target.current.id === ws.id) openSignIn();
    }
  };

  // Checks the account, then publishes or asks to sign in. Asked on every
  // run: a sign-in that finished after a reload, or a server that was down
  // at launch, changes the answer.
  const start = async () => {
    if (publishing()) return;
    const ws = { id: workspaceId, name: workspaceName };
    target.current = ws;
    const id = beginPublish(ws.id, site());
    const result = await refetchAccount();
    if (!isCurrentRun(ws.id, id)) return;
    // By status: a failed refetch keeps the last account it loaded.
    if (result.isError) {
      const code = result.error instanceof AccountRequestError ? result.error.code : "";
      failPublish(ws.id, id, { kind: "SERVER_ERROR", message: problem(code) });
    } else if (result.data) {
      void publish(ws, id, result.data);
    } else {
      clearPublish(ws.id);
      if (panelRef.current === "publish") openSignIn();
    }
  };

  const askAgent = () => {
    const ws = target.current;
    const failed = usePublishStore.getState().runs[ws.id];
    if (!failed?.failure || failed.sentToClaude) return;
    setSentToAgent(ws.id, failed.id, true);
    sendToChat
      .send({
        prompt: fixBuildPrompt(ws.name, failed.failure.detail ?? failed.failure.message),
        title: `Fix the build error in ${ws.name}`,
        model: composer.selectedModelId,
        effort: composer.effort,
        target: { workspaceId: ws.id, conversationId: null },
      })
      .catch((error) => {
        console.error("Couldn't send the build error to the agent:", error);
        setSentToAgent(ws.id, failed.id, false);
      });
  };

  // Ends the browser flow main is waiting on, if there is one.
  const abandonSignIn = () => {
    if (signInStepRef.current === "waiting") cancelSignInMutation.mutate();
  };

  const signIn = () => {
    // aria-disabled, not disabled, while waiting: the button keeps focus.
    if (!canAct()) return;
    clear();
    setSignInError(null);
    setSignInStep("waiting");
    signInMutation.mutate(undefined, {
      onSuccess: (account) => {
        if (panelRef.current !== "signin" || signInStepRef.current !== "waiting") {
          // Cancelled as the token was being saved: signed in after all, so
          // don't keep offering sign-in. Closed meanwhile: stay closed. Either
          // way, don't publish.
          if (panelRef.current === "signin") close();
          return;
        }
        setLinked(true);
        later(LINKED_BEAT_MS, () => {
          if (panelRef.current !== "signin") return;
          setLinked(false);
          setPanel("publish");
          const ws = target.current;
          void publish(ws, beginPublish(ws.id, site()), account);
        });
      },
      onError: (error) => {
        if (error.code === "CANCELLED") return;
        if (panelRef.current === "signin" && signInStepRef.current === "waiting") {
          setSignInError(problem(error.code));
          setAttempt((n) => n + 1);
          setSignInStep("error");
        }
      },
    });
  };

  const backToSignIn = () => {
    if (signInStepRef.current !== "waiting") return;
    clear();
    abandonSignIn();
    setLinked(false);
    setSignInError(null);
    setSignInStep("signin");
  };

  const close = () => {
    if (!canClose()) return;
    clear();
    if (panelRef.current === "signin") abandonSignIn();
    // A site that went live is done with: next time starts from the confirm
    // view. A failure stays, with its way forward, until it's tried again.
    if (usePublishStore.getState().runs[target.current.id]?.step === "done") clearPublish(target.current.id);
    setLinked(false);
    setPanel(null);
  };

  const onPublishClick = () => {
    if (panelRef.current) return close();
    target.current = { id: workspaceId, name: workspaceName };
    setPanel("publish");
  };

  // Keyboard focus stays on the sign-in panel's button: Cancel and the
  // Connected beat take the control focus was on away, and the dialog itself
  // has no visible focus.
  useEffect(() => {
    if (panelRef.current !== "signin") return;
    const focused = document.activeElement;
    if (!focused || focused === document.body || focused.getAttribute("role") === "dialog") {
      signInButton.current?.focus();
    }
  }, [panel, signInStep, linked]);

  const running = isRunning(run);
  const mode: ButtonMode = !run ? "idle" : run.step === "done" ? "live" : run.failure ? "idle" : "running";
  const state: PublishState = run ?? { site: site(), step: "confirm", meta: {}, log: [] };
  const busy = signInStep === "waiting";

  return (
    <PopoverPrimitive.Root
      open={panel !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      modal
    >
      <PopoverPrimitive.Anchor asChild>
        <PublishTitlebarButton
          ref={publishButton}
          mode={mode}
          state={run}
          onClick={onPublishClick}
          pressed={panel === "publish"}
        />
      </PopoverPrimitive.Anchor>

      {/* Catches clicks outside the panel. Radix's modal turns off pointer
          events on the page, but the canvas's frames turn theirs back on, so a
          click could land in a frame and take focus. A click here is an outside
          click to Radix (closes, unless busy). */}
      {panel &&
        createPortal(
          <div data-publish-overlay className="pointer-events-auto fixed inset-0 z-[105]" aria-hidden />,
          document.body,
        )}

      <AnimatePresence initial={false}>
        {panel && (
          <PopoverPrimitive.Portal forceMount>
            <PopoverPrimitive.Content
              forceMount
              asChild
              side="bottom"
              align="end"
              sideOffset={8}
              {...(panel === "signin"
                ? { "aria-labelledby": "publish-handshake-title" }
                : { "aria-label": state.step === "done" ? `${state.site.name} is live` : `Publish ${state.site.name}` })}
              onOpenAutoFocus={(e) => {
                e.preventDefault();
                const content = e.currentTarget as HTMLElement | null;
                if (panelRef.current === "signin") signInButton.current?.focus();
                else (content?.querySelector<HTMLElement>("[data-autofocus]") ?? content)?.focus();
              }}
              onCloseAutoFocus={(e) => {
                e.preventDefault();
                publishButton.current?.focus();
              }}
              onEscapeKeyDown={(e) => {
                // Read live: a panel animating out keeps this handler.
                if (panelRef.current === "signin" && signInStepRef.current === "waiting" && !linkedRef.current) {
                  e.preventDefault();
                  backToSignIn();
                } else if (!canDismiss()) e.preventDefault();
              }}
              onPointerDownOutside={(e) => {
                if (!canDismiss()) {
                  e.preventDefault();
                  return;
                }
                // A second click of a double-click on Publish keeps the panel.
                const { clientX: x, clientY: y } = e.detail.originalEvent;
                const r = publishButton.current?.getBoundingClientRect();
                if (r && r.width > 0 && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) e.preventDefault();
              }}
            >
              <motion.div
                // Above the See Code panel (z-[100]), below its copy menu (z-[200]).
                className="relative z-[110] outline-none"
                style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}
                initial={{ opacity: 0, scale: reduce ? 1 : 0.97, y: reduce ? 0 : -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: EXIT }}
                transition={SPRING}
              >
                <CoversCanvas />
                {panel === "publish" ? (
                  <PublishPanel
                    state={state}
                    actions={{ onPublish: () => void start(), onRetry: () => void start(), onAskClaude: askAgent }}
                    onClose={close}
                  />
                ) : (
                  <div className="relative flex w-[320px] flex-col items-start rounded-[14px] border border-[#2d2d2d] bg-[#2c2c2c] p-5 text-left antialiased shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)]">
                    <button
                      type="button"
                      aria-label="Close"
                      onClick={close}
                      className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-200"
                    >
                      <X size={14} />
                    </button>

                    <img src={antidrawIcon} alt="Antidraw" className="h-10 w-10" />

                    <h2 id="publish-handshake-title" className="mt-4 text-base font-medium tracking-[-0.01em] text-[#e0e0e0]">
                      Sign in to publish
                    </h2>
                    <p className="mt-1.5 text-[13px] leading-[1.6] text-[#9a9a9a]">
                      {busy
                        ? "Finish signing in with Google in your browser. We'll publish right after."
                        : `Once you're signed in, ${target.current.name} goes live on a link you can share.`}
                    </p>

                    <button
                      ref={signInButton}
                      type="button"
                      onClick={signIn}
                      aria-disabled={busy || linked}
                      className="mt-5 flex h-10 w-full items-center justify-center gap-2.5 rounded-[10px] border border-white/[0.12] bg-white/[0.08] text-sm font-medium text-[#e0e0e0] transition-colors hover:border-white/[0.24] hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 aria-disabled:cursor-default aria-disabled:hover:border-white/[0.12] aria-disabled:hover:bg-white/[0.08]"
                    >
                      {linked ? (
                        <>
                          <Check size={15} strokeWidth={2.5} style={{ color: GREEN }} />
                          Connected
                        </>
                      ) : busy ? (
                        <>
                          <LoaderCircle size={15} className="animate-spin text-[#9a9a9a]" />
                          <span className="text-[#9a9a9a]">Waiting for Google…</span>
                        </>
                      ) : (
                        <>
                          <GoogleG size={16} />
                          {signInStep === "error" ? "Try again" : "Sign in with Google"}
                        </>
                      )}
                    </button>

                    {/* Announced: what the button now shows. The page behind is hidden from
                        assistive tech while the panel is open, so this lives in the panel. */}
                    <span role="status" className="sr-only">
                      {linked ? "Signed in" : busy ? "Waiting for Google sign-in in your browser" : ""}
                    </span>

                    {/* only shown when there's something to say */}
                    {(busy || signInStep === "error") && (
                      <div className="mt-3 flex min-h-4 items-center text-[11px]">
                        {busy ? (
                          <button
                            type="button"
                            onClick={backToSignIn}
                            disabled={linked}
                            className="text-neutral-400 transition-colors hover:text-neutral-200 disabled:opacity-0"
                          >
                            Cancel
                          </button>
                        ) : (
                          // Keyed by attempt, so the same message is announced again.
                          <span key={attempt} role="alert" style={{ color: RED }}>
                            {signInError}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        )}
      </AnimatePresence>
    </PopoverPrimitive.Root>
  );
};
