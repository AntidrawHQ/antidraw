import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popover as PopoverPrimitive } from "radix-ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy, Globe, LoaderCircle, X } from "lucide-react";
import antidrawIcon from "@/renderer/assets/antidraw-icon.svg";
import {
  AccountRequestError,
  useAccount,
  useCancelSignIn,
  usePublishWorkspace,
  useSignIn,
} from "@/renderer/lib/account-ops";

/* ────────────────────────────────────────────────────────────
   Publish button for the titlebar. Signed out, it opens a minimal
   sign-in panel anchored under the button: Antidraw icon, one-line
   title, a single "Sign in with Google" button that carries every
   state. On success the panel closes and publishing continues.

   The panel is a modal Radix popover: it traps focus, gives it back
   to the Publish button on close, and takes Escape only when it's
   the topmost layer.
   ──────────────────────────────────────────────────────────── */

// Quick and smooth: a strong ease-out, a critically damped spring (no
// overshoot, no long tail), and exits shorter than entrances.
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SPRING = { type: "spring" as const, visualDuration: 0.18, bounce: 0 };
const EXIT = { duration: 0.12, ease: EASE_OUT };
const GREEN = "oklch(0.696 0.17 162.48)";
const RED = "oklch(0.704 0.191 22.216)";
const tint = (c: string, p: number) => `color-mix(in oklch, ${c} ${p}%, transparent)`;

// How long "Connected" shows before publishing starts, and how long the
// published toast stays up.
const LINKED_BEAT_MS = 500;
const PUBLISHED_TOAST_MS = 4900;

type Step =
  | "closed"
  | "checking" // asking main whether we're signed in
  | "signin"
  | "waiting"
  | "error"
  | "publishing"
  | "published";

// What went wrong, and what "Try again" does about it.
type Failure = { message: string; retry: "signin" | "publish" };

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
}: {
  workspaceId: string;
  workspaceName: string;
}) => {
  const reduce = !!useReducedMotion();
  const [step, setStep] = useState<Step>("closed");
  const [linked, setLinkedState] = useState(false); // brief green beat before the modal closes
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [failure, setFailureState] = useState<Failure | null>(null);
  // Counts failures, so the same message is announced again on a retry.
  const [attempt, setAttempt] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const publishButton = useRef<HTMLButtonElement>(null);
  const signInButton = useRef<HTMLButtonElement>(null);

  // Live copies of the state, for guards and callbacks that run from an old
  // render: a mutation callback, or the panel while it animates out (it keeps
  // its last handlers and can still take a click, Enter or Escape). Each is
  // set together with its state, so a second click in the same frame already
  // sees the first.
  const stepRef = useRef(step);
  const failureRef = useRef(failure);
  const linkedRef = useRef(linked);
  const go = (next: Step) => {
    stepRef.current = next;
    setStep(next);
  };
  const setFailure = (next: Failure | null) => {
    failureRef.current = next;
    setFailureState(next);
  };
  const setLinked = (next: boolean) => {
    linkedRef.current = next;
    setLinkedState(next);
  };
  // The workspace a click on Publish is for: the active one can change while
  // the account is checked or the user signs in.
  const target = useRef({ id: workspaceId, name: workspaceName });
  // The latest account check; one the user walked away from is ignored.
  const checkRun = useRef(0);

  const { refetch: refetchAccount } = useAccount();
  const signInMutation = useSignIn();
  const cancelSignInMutation = useCancelSignIn();
  const publishMutation = usePublishWorkspace();

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  // Whether the panel is up (a retry of the account check keeps it), and
  // whether its Sign in / Try again button may act.
  const panelIsUp = () => {
    const now = stepRef.current;
    return (
      now === "signin" ||
      now === "waiting" ||
      now === "error" ||
      (now === "checking" && failureRef.current?.retry === "publish")
    );
  };
  const canAct = () => stepRef.current === "signin" || stepRef.current === "error";

  const fail = (next: Failure) => {
    setFailure(next);
    setAttempt((n) => n + 1);
    go("error");
  };

  const publish = () => {
    setLinked(false);
    go("publishing");
    publishMutation.mutate(target.current.id, {
      onSuccess: ({ url }) => {
        setLink(url);
        go("published");
        later(PUBLISHED_TOAST_MS, () => {
          if (stepRef.current === "published") go("closed");
        });
      },
      onError: (error) => {
        if (error.code === "SIGNED_OUT") {
          setFailure(null);
          go("signin");
          return;
        }
        console.error("Publish failed:", error);
        go("closed");
      },
    });
  };

  // Ends the browser flow main is waiting on, if there is one.
  const abandonSignIn = () => {
    if (stepRef.current === "waiting") cancelSignInMutation.mutate();
  };

  // Checks the account, then publishes or asks to sign in. Asked on every
  // click: a sign-in that finished after a reload, or a server that was down
  // at launch, changes the answer. A retry from the "Couldn't publish" panel
  // keeps the panel (and its message) up while it checks.
  const checkThenPublish = async () => {
    clear();
    abandonSignIn();
    setLinked(false);
    go("checking");
    const run = ++checkRun.current;
    const result = await refetchAccount();
    if (run !== checkRun.current || stepRef.current !== "checking") return;
    // By status: a failed refetch keeps the last account it loaded.
    if (result.isError)
      fail({
        message: problem(result.error instanceof AccountRequestError ? result.error.code : ""),
        retry: "publish",
      });
    else if (result.data) {
      setFailure(null);
      publish();
    } else {
      setFailure(null);
      go("signin");
    }
  };

  const onPublishClick = () => {
    if (stepRef.current === "publishing" || stepRef.current === "checking") return;
    target.current = { id: workspaceId, name: workspaceName };
    setFailure(null);
    void checkThenPublish();
  };

  const retryPublish = () => {
    if (canAct()) void checkThenPublish();
  };

  const signIn = () => {
    // aria-disabled, not disabled, while waiting: the button keeps focus.
    if (!canAct()) return;
    clear();
    setFailure(null);
    go("waiting");
    signInMutation.mutate(undefined, {
      onSuccess: () => {
        if (stepRef.current !== "waiting") {
          // Cancelled as the token was being saved: signed in after all, so
          // don't keep offering sign-in. Closed meanwhile: stay closed. Either
          // way, don't publish.
          if (stepRef.current === "signin" || stepRef.current === "error") go("closed");
          return;
        }
        setLinked(true);
        later(LINKED_BEAT_MS, publish);
      },
      onError: (error) => {
        if (error.code === "CANCELLED") return;
        if (stepRef.current === "waiting") fail({ message: problem(error.code), retry: "signin" });
      },
    });
  };

  const backToSignIn = () => {
    if (stepRef.current !== "waiting") return;
    clear();
    abandonSignIn();
    setLinked(false);
    setFailure(null);
    go("signin");
  };

  const close = () => {
    if (!panelIsUp()) return;
    clear();
    abandonSignIn();
    checkRun.current++;
    setLinked(false);
    setFailure(null);
    go("closed");
  };

  // Keyboard focus stays on the panel's button: Cancel and the Connected
  // beat take the control focus was on away, and the dialog itself has no
  // visible focus.
  useEffect(() => {
    if (!panelIsUp()) return;
    const focused = document.activeElement;
    if (!focused || focused === document.body || focused.getAttribute("role") === "dialog") {
      signInButton.current?.focus();
    }
  }, [step, linked]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  // A retry of the account check keeps the panel it came from.
  const rechecking = step === "checking" && failure?.retry === "publish";
  const panelOpen = step === "signin" || step === "waiting" || step === "error" || rechecking;
  const busy = step === "waiting";
  const retryingPublish = failure?.retry === "publish";

  return (
    <>
      <PopoverPrimitive.Root
        open={panelOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        modal
      >
        <PopoverPrimitive.Anchor asChild>
          <button
            ref={publishButton}
            type="button"
            onClick={onPublishClick}
            aria-busy={step === "checking" || step === "publishing"}
            className="flex h-[26px] min-w-[84px] items-center justify-center gap-1.5 rounded-lg bg-[#e0e0e0] px-2.5 text-[13px] font-medium text-neutral-900 transition-colors hover:bg-white"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            {step === "publishing" ? (
              <>
                <LoaderCircle size={13} className="animate-spin" />
                Publishing
              </>
            ) : step === "published" ? (
              <>
                <Check size={13} strokeWidth={2.5} />
                Published
              </>
            ) : (
              <>
                {step === "checking" ? (
                  <LoaderCircle size={13} className="animate-spin" />
                ) : (
                  <Globe size={13} strokeWidth={2.2} />
                )}
                Publish
              </>
            )}
          </button>
        </PopoverPrimitive.Anchor>

        {/* Catches clicks outside the panel. Radix's modal turns off pointer
            events on the page, but the canvas's frames turn theirs back on, so a
            click could land in a frame and take focus. A click here is an outside
            click to Radix (closes, unless busy). */}
        {panelOpen &&
          createPortal(
            <div data-publish-overlay className="pointer-events-auto fixed inset-0 z-[105]" aria-hidden />,
            document.body,
          )}

        {/* the panel */}
        <AnimatePresence initial={false}>
          {panelOpen && (
            <PopoverPrimitive.Portal forceMount>
              <PopoverPrimitive.Content
                forceMount
                asChild
                side="bottom"
                align="end"
                sideOffset={8}
                aria-labelledby="publish-handshake-title"
                onOpenAutoFocus={(e) => {
                  e.preventDefault();
                  signInButton.current?.focus();
                }}
                onCloseAutoFocus={(e) => {
                  e.preventDefault();
                  publishButton.current?.focus();
                }}
                onEscapeKeyDown={(e) => {
                  // Read live: a panel animating out keeps this handler.
                  if (!panelIsUp() || linkedRef.current) e.preventDefault();
                  else if (stepRef.current === "waiting") {
                    e.preventDefault();
                    backToSignIn();
                  }
                }}
                onPointerDownOutside={(e) => {
                  if (!panelIsUp() || stepRef.current === "waiting" || linkedRef.current) {
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
                  className="relative z-[110] flex w-[320px] flex-col items-start rounded-[14px] border border-[#2d2d2d] bg-[#2c2c2c] p-5 text-left antialiased shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)] outline-none"
                  style={{ transformOrigin: "var(--radix-popover-content-transform-origin)" }}
                  initial={{ opacity: 0, scale: reduce ? 1 : 0.97, y: reduce ? 0 : -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: EXIT }}
                  transition={SPRING}
                >
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
                    {retryingPublish ? "Couldn't publish" : "Sign in to publish"}
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-[1.6] text-[#9a9a9a]">
                    {busy
                      ? "Finish signing in with Google in your browser. We'll publish right after."
                      : retryingPublish
                        ? `We couldn't check your account, so ${target.current.name} wasn't published.`
                        : `Once you're signed in, ${target.current.name} goes live on a link you can share.`}
                  </p>

                  <button
                    ref={signInButton}
                    type="button"
                    onClick={retryingPublish ? retryPublish : signIn}
                    aria-disabled={busy || linked || rechecking}
                    className="mt-5 flex h-10 w-full items-center justify-center gap-2.5 rounded-[10px] border border-white/[0.12] bg-white/[0.08] text-sm font-medium text-[#e0e0e0] transition-colors hover:border-white/[0.24] hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 aria-disabled:cursor-default aria-disabled:hover:border-white/[0.12] aria-disabled:hover:bg-white/[0.08]"
                  >
                    {linked ? (
                      <>
                        <Check size={15} strokeWidth={2.5} style={{ color: GREEN }} />
                        Connected
                      </>
                    ) : busy || rechecking ? (
                      <>
                        <LoaderCircle size={15} className="animate-spin text-[#9a9a9a]" />
                        <span className="text-[#9a9a9a]">{busy ? "Waiting for Google…" : "Checking…"}</span>
                      </>
                    ) : (
                      <>
                        {!retryingPublish && <GoogleG size={16} />}
                        {step === "error" ? "Try again" : "Sign in with Google"}
                      </>
                    )}
                  </button>

                  {/* Announced: what the button now shows. The page behind is hidden from
                      assistive tech while the panel is open, so this lives in the panel. */}
                  <span role="status" className="sr-only">
                    {linked
                      ? "Signed in"
                      : busy
                        ? "Waiting for Google sign-in in your browser"
                        : rechecking
                          ? "Checking your account"
                          : ""}
                  </span>

                  {/* only shown when there's something to say */}
                  {(busy || step === "error" || rechecking) && (
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
                          {failure?.message}
                        </span>
                      )}
                    </div>
                  )}
                </motion.div>
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          )}
        </AnimatePresence>
      </PopoverPrimitive.Root>

      <span role="status" className="sr-only">
        {step === "publishing" ? "Publishing" : step === "checking" && !rechecking ? "Checking your account" : ""}
      </span>

      {createPortal(
        <AnimatePresence>
          {step === "published" && link && (
            <motion.div
              role="status"
              className="fixed bottom-5 right-5 z-[120] flex items-center gap-3 rounded-[10px] border border-[#2d2d2d] bg-[#2c2c2c] py-2 pl-3 pr-2 antialiased shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7)]"
              initial={{ opacity: 0, y: reduce ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : 4, transition: EXIT }}
              transition={SPRING}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: tint(GREEN, 16), color: GREEN }}>
                <Check size={11} strokeWidth={3} />
              </span>
              <span className="text-[13px] text-[#e0e0e0]">Published</span>
              <span className="font-mono text-[11px] text-neutral-400">{link.replace(/^https?:\/\//, "")}</span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(link).catch(() => {});
                  setCopied(true);
                }}
                className="flex h-7 items-center gap-1.5 rounded-md bg-white/[0.08] px-2.5 text-[12px] font-medium text-neutral-200 transition-colors hover:bg-white/[0.12]"
              >
                {copied ? <Check size={12} style={{ color: GREEN }} /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
};
