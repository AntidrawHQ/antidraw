import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy, Globe, LoaderCircle, X } from "lucide-react";
import antidrawIcon from "@/renderer/assets/antidraw-icon.svg";
import {
  useAccount,
  useCancelSignIn,
  usePublishWorkspace,
  useSignIn,
} from "@/renderer/lib/account-ops";

/* ────────────────────────────────────────────────────────────
   Publish button for the titlebar. Signed out, it opens a minimal
   sign-in panel anchored under the button: AntiDraw icon, one-line
   title, a single "Sign in with Google" button that carries every
   state. On success the panel closes and publishing continues.
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

type Step = "closed" | "signin" | "waiting" | "error" | "publishing" | "published";

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
  const [linked, setLinked] = useState(false); // brief green beat before the modal closes
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // For mutation callbacks, which outlive the render that started them.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });

  const { data: account } = useAccount();
  const signInMutation = useSignIn();
  const cancelSignInMutation = useCancelSignIn();
  const publishMutation = usePublishWorkspace();

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  const publish = () => {
    setLinked(false);
    setStep("publishing");
    publishMutation.mutate(workspaceId, {
      onSuccess: ({ url }) => {
        setLink(url);
        setStep("published");
        later(PUBLISHED_TOAST_MS, () => setStep((s) => (s === "published" ? "closed" : s)));
      },
      onError: (error) => {
        if (error.code === "SIGNED_OUT") {
          setStep("signin");
          return;
        }
        console.error("Publish failed:", error);
        setStep("closed");
      },
    });
  };

  // Ends the browser flow main is waiting on, if there is one.
  const abandonSignIn = () => {
    if (stepRef.current === "waiting") cancelSignInMutation.mutate();
  };

  const onPublishClick = () => {
    clear();
    if (step === "publishing") return;
    abandonSignIn();
    setLinked(false);
    if (account) publish();
    else setStep("signin");
  };

  const signIn = () => {
    clear();
    setStep("waiting");
    signInMutation.mutate(undefined, {
      onSuccess: () => {
        // Closed or cancelled while the browser was finishing: stay signed in, don't publish.
        if (stepRef.current !== "waiting") return;
        setLinked(true);
        later(LINKED_BEAT_MS, publish);
      },
      onError: (error) => {
        if (error.code === "CANCELLED") return;
        setStep((s) => (s === "waiting" ? "error" : s));
      },
    });
  };

  const backToSignIn = () => {
    clear();
    abandonSignIn();
    setLinked(false);
    setStep("signin");
  };

  const close = () => {
    clear();
    abandonSignIn();
    setLinked(false);
    setStep("closed");
  };

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || linked) return;
      if (step === "waiting") backToSignIn();
      else if (step === "signin" || step === "error") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const modalOpen = step === "signin" || step === "waiting" || step === "error";
  const busy = step === "waiting";

  return (
    <>
      <button
        type="button"
        onClick={onPublishClick}
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
            <Globe size={13} strokeWidth={2.2} />
            Publish
          </>
        )}
      </button>

      {createPortal(
        <>
          {/* modal */}
          <AnimatePresence initial={false}>
            {modalOpen && (
              <motion.div
                className="fixed inset-0 top-[38px] z-40 flex items-start justify-end pr-3 pt-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: EXIT }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
                onMouseDown={(e) => {
                  if (e.target === e.currentTarget && !busy) close();
                }}
              >
                <motion.div
                  role="dialog"
                  aria-modal
                  aria-labelledby="publish-handshake-title"
                  className="relative flex w-[320px] origin-top-right flex-col items-start rounded-[14px] border border-[#2d2d2d] bg-[#2c2c2c] p-5 text-left shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)]"
                  initial={{ opacity: 0, scale: reduce ? 1 : 0.97, y: reduce ? 0 : -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: EXIT }}
                  transition={SPRING}
                >
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={close}
                    className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-300"
                  >
                    <X size={14} />
                  </button>

                  <img src={antidrawIcon} alt="AntiDraw" className="h-10 w-10" />

                  <h2 id="publish-handshake-title" className="mt-4 text-base font-medium tracking-[-0.01em] text-[#e0e0e0]">
                    Sign in to publish
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-[1.6] text-[#9a9a9a]">
                    {busy
                      ? "Finish signing in with Google in your browser. We'll publish right after."
                      : `Once you're signed in, ${workspaceName} goes live on a link you can share.`}
                  </p>

                  <button
                    type="button"
                    onClick={signIn}
                    disabled={busy}
                    autoFocus
                    className="mt-5 flex h-10 w-full items-center justify-center gap-2.5 rounded-[10px] border border-white/[0.12] bg-white/[0.08] text-sm font-medium text-[#e0e0e0] transition-colors hover:border-white/[0.24] hover:bg-white/[0.12] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-white/20 disabled:hover:border-white/[0.12] disabled:hover:bg-white/[0.08]"
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
                        {step === "error" ? "Try again" : "Sign in with Google"}
                      </>
                    )}
                  </button>

                  {/* only shown when there's something to say */}
                  {(busy || step === "error") && (
                    <div className="mt-3 flex h-4 items-center text-[11px]">
                      {busy ? (
                        <button
                          type="button"
                          onClick={backToSignIn}
                          disabled={linked}
                          className="text-neutral-500 transition-colors hover:text-neutral-300 disabled:opacity-0"
                        >
                          Cancel
                        </button>
                      ) : (
                        <span style={{ color: RED }}>Couldn't connect to Google. Try again.</span>
                      )}
                    </div>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* published toast */}
          <AnimatePresence>
            {step === "published" && link && (
              <motion.div
                className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-[10px] border border-[#2d2d2d] bg-[#2c2c2c] py-2 pl-3 pr-2 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7)]"
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : 4, transition: EXIT }}
                transition={SPRING}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: tint(GREEN, 16), color: GREEN }}>
                  <Check size={11} strokeWidth={3} />
                </span>
                <span className="text-[13px] text-[#e0e0e0]">Published</span>
                <span className="font-mono text-[11px] text-neutral-500">{link.replace(/^https?:\/\//, "")}</span>
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
          </AnimatePresence>
        </>,
        document.body,
      )}
    </>
  );
};
