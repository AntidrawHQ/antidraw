import { useCallback, useEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronRight, Copy, Globe, LoaderCircle, X } from "lucide-react";
import antidrawIcon from "@/renderer/assets/antidraw-icon.svg";
import type { Conversation } from "@/main/api";
import {
  AccountRequestError,
  useAccount,
  useCancelSignIn,
  usePublishStatus,
  useSetAllowRemix,
  useSignIn,
} from "@/renderer/lib/account-ops";
import {
  canCancelPublish,
  cancelPublishRun,
  checkPublishStatus,
  dismissPublishRun,
  isFollowedFailure,
  startPublish,
  usePublishRuns,
  type PublishProgress,
  type StatusCheck,
} from "@/renderer/lib/publish-runs";
import { queryKeys } from "@/renderer/lib/query-keys";
import { LAYER } from "@/renderer/lib/layers";
import { cn } from "@/renderer/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/renderer/components/ui/collapsible";
import {
  PublishDetails,
  countNotIncluded,
  formatBytes,
} from "@/renderer/components/PublishDetails";

/* ────────────────────────────────────────────────────────────
   Publish button for the titlebar. Signed out, it opens a minimal
   sign-in panel anchored under the button: AntiDraw icon, one-line
   title, a single "Sign in with Google" button that carries every
   state. On success the panel closes and publishing continues.
   While publishing, the label follows the steps and hovering it
   offers Cancel (until "Finishing"; not in the run's first moment, nor
   to the pointer that started it until it leaves); a failure opens
   a panel in the same place with what went wrong and "Try again";
   success shows a toast with the link, the remix setting and what
   was left out.
   ──────────────────────────────────────────────────────────── */

// Quick and smooth: a strong ease-out, a critically damped spring (no
// overshoot, no long tail), and exits shorter than entrances.
const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const SPRING = { type: "spring" as const, visualDuration: 0.18, bounce: 0 };
const EXIT = { duration: 0.12, ease: EASE_OUT };
const GREEN = "oklch(0.696 0.17 162.48)";
const RED = "oklch(0.704 0.191 22.216)";
const tint = (c: string, p: number) => `color-mix(in oklch, ${c} ${p}%, transparent)`;

// The panel and the toast carry the publish result, so they sit above the
// code side panel, which covers the right edge where both are anchored.
export const PANEL_CLASS = cn(
  "fixed inset-0 top-[38px] flex items-start justify-end pr-3 pt-2",
  LAYER.overlay,
);
export const TOAST_CLASS = cn(
  "fixed bottom-5 right-5 flex flex-col gap-1.5 rounded-[10px] border border-[#2d2d2d] bg-[#2c2c2c] py-2 pl-3 pr-2 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7)]",
  LAYER.overlay,
);

// How long "Connected" shows before publishing starts, and how long the
// published toast stays up.
const LINKED_BEAT_MS = 500;
const PUBLISHED_TOAST_MS = 4900;

type SignInStep = "signin" | "waiting" | "error";

type Step =
  | "closed"
  | "signin"
  | "waiting"
  | "error"
  | "publishing"
  | "published"
  | "failed";

const progressLabel = ({ step, percent }: PublishProgress) => {
  switch (step) {
    case "checking":
      return "Publishing";
    case "snapshot":
      return "Snapshotting";
    case "building":
      return "Building";
    case "uploading":
      return percent === null ? "Uploading" : `Uploading ${percent}%`;
    case "finishing":
      return "Finishing";
  }
};

// What a click on the titlebar button does (exported for tests). While a run
// is publishing it can only cancel. Otherwise it starts one, except for the
// later clicks of a multi-click (detail > 1; the keyboard's detail is 0): their
// first click already acted, and when that click was Cancel, main reports the
// cancel well inside a double-click, so the second click would find "Publish"
// under the pointer and start the very publish the user just stopped.
export const publishClickAction = (
  publishing: boolean,
  canCancel: boolean,
  detail: number,
): "cancel" | "start" | "none" =>
  publishing ? (canCancel ? "cancel" : "none") : detail > 1 ? "none" : "start";

// The button's accessible name while publishing (exported for tests): the
// progress, and that activating it cancels when it would.
export const publishingName = (label: string, canCancel: boolean) =>
  canCancel ? `${label}. Activate to cancel` : label;

// What the live region says while publishing: the step, not every percent.
export const publishingAnnouncement = (progress: PublishProgress, cancelling: boolean) =>
  cancelling ? "Cancelling publish" : progressLabel({ step: progress.step, percent: null });

// The publishing label inside the titlebar button (exported for tests). Hover
// swaps the progress for "Cancel" in the same cell, so the width holds. Focus
// does not: a keyboard user keeps seeing the progress, and the spinner turns
// into an X to say the button now cancels.
export function PublishingLabel({
  label,
  canCancel,
}: {
  label: string;
  canCancel: boolean;
}) {
  return (
    <span className="grid">
      <span
        className={cn(
          "flex items-center justify-center gap-1.5 [grid-area:1/1]",
          canCancel && "group-hover:invisible",
        )}
      >
        <LoaderCircle
          size={13}
          className={cn("animate-spin", canCancel && "group-focus-visible:hidden")}
        />
        {canCancel && (
          <X size={13} strokeWidth={2.5} className="hidden group-focus-visible:block" />
        )}
        {label}
      </span>
      {canCancel && (
        <span className="invisible flex items-center justify-center gap-1.5 [grid-area:1/1] group-hover:visible">
          <X size={13} strokeWidth={2.5} />
          Cancel
        </span>
      )}
    </span>
  );
}

// Whether a panel that has just opened may move focus onto its button: only
// while focus is still on the Publish button, where the user just clicked.
// A panel that opens on its own later (a failure, a sign-in the publish
// asked for) must not pull focus out of the composer, where the next Space or
// Enter would press its button and start a publish or a sign-in.
export const panelTakesFocus = (
  active: Element | null,
  publishButton: Element | null,
): boolean => !!active && !!publishButton && publishButton.contains(active);

// A "Still finishing" panel (exported for tests): the publish may yet go live,
// and publish-runs keeps finishing it in the background whether or not the
// panel is up. It opens on its own, often while the user is working, so it
// does not act as a modal: clicks outside it go through to the app, and only
// the X, or Escape from inside it, closes it.
export const isStillFinishing = (error: AccountRequestError, check: StatusCheck | null) =>
  isFollowedFailure(error) && check !== "ended" && check !== "unknown";

// Whether a click on the backdrop or an Escape closes the panel (exported for
// tests). The X always does.
export const panelDismisses = (
  via: "backdrop" | "escape",
  stillFinishing: boolean,
  focusInPanel: boolean,
): boolean => !stillFinishing || (via === "escape" && focusInPanel);

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

// The panel body for a failed publish (exported for tests): what went wrong, whatever detail
// helps fix it, and the one action that makes sense next.
export function FailureContent({
  error,
  onRetry,
  onCheckStatus,
  checking,
  check,
  buttonRef,
}: {
  error: AccountRequestError;
  onRetry: () => void;
  onCheckStatus: () => void;
  checking: boolean; // a "Check status" is in flight
  check: StatusCheck | null;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const details = error.details ?? {};
  const outcomeUnknown = error.code === "PUBLISH_OUTCOME_UNKNOWN";
  const stillFinishing = isStillFinishing(error, check);
  // Checking again can't tell without the site's version from before the
  // publish, and a session that ended will never go live: either way the next
  // useful step is publishing again.
  const canCheck = outcomeUnknown && check !== "unknown" && check !== "ended";
  const message =
    error.code === "WORKSPACE_BUSY"
      ? "Claude is still working. Publish when the turn finishes."
      : error.code === "SITE_LIMIT" && details.siteLimit !== undefined
        ? `You have reached the limit of ${details.siteLimit} published canvases.`
        : error.message;
  // A refusal with a `reason` is about what is waiting on the server (files or
  // sessions of unfinished publishes), not this canvas's size or the
  // account's quota: its numbers and largest files would mislead.
  const serverBacklog = details.reason !== undefined;
  const largest =
    (error.code === "PUBLISH_TOO_LARGE" || error.code === "QUOTA_EXCEEDED") && !serverBacklog
      ? (details.largestFiles ?? []).slice(0, 5)
      : [];
  const paths =
    error.code === "SNAPSHOT_FAILED" ? (details.paths ?? []).slice(0, 5) : [];
  const collisions =
    error.code === "CASE_COLLISION" ? (details.collisions ?? []) : [];
  const logTail = error.code === "BUILD_FAILED" ? (details.logTail ?? []) : [];

  return (
    <>
      <span
        className="flex h-8 w-8 items-center justify-center rounded-full"
        style={{ background: tint(outcomeUnknown ? "#9a9a9a" : RED, 16), color: outcomeUnknown ? "#c8c8c8" : RED }}
      >
        {outcomeUnknown ? <LoaderCircle size={16} /> : <AlertCircle size={16} />}
      </span>

      <h2 id="publish-failed-title" className="mt-4 text-base font-medium tracking-[-0.01em] text-[#e0e0e0]">
        {outcomeUnknown ? "Still finishing" : "Couldn't publish"}
      </h2>
      <p className="mt-1.5 text-[13px] leading-[1.6] text-[#9a9a9a]">{message}</p>

      {error.code === "QUOTA_EXCEEDED" &&
        !serverBacklog &&
        details.usedBytes !== undefined &&
        details.quotaBytes !== undefined && (
          <p className="mt-1.5 text-[12px] leading-[1.6] text-[#9a9a9a]">
            {formatBytes(details.usedBytes)} of {formatBytes(details.quotaBytes)} in use
            {details.publishBytes !== undefined &&
              `; this publish needs ${formatBytes(details.publishBytes)} more`}
            .
          </p>
        )}

      {error.code === "SITE_TOO_LARGE" && details.siteBytes !== undefined && (
        <p className="mt-1.5 text-[12px] leading-[1.6] text-[#9a9a9a]">
          The site is {formatBytes(details.siteBytes)}
          {details.siteFileCount !== undefined && ` in ${details.siteFileCount} files`}.
        </p>
      )}

      {largest.length > 0 && (
        <div className="mt-3 w-full">
          <div className="mb-1 text-[11px] text-neutral-500">Largest files</div>
          <ul className="flex w-full flex-col rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-2.5 py-1">
            {largest.map((file) => (
              <li key={file.path} className="flex items-baseline justify-between gap-3 py-1">
                <span className="min-w-0 truncate font-mono text-[11px] text-[#e0e0e0]">{file.path}</span>
                <span className="shrink-0 text-[11px] text-neutral-500">{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {collisions.length > 0 && (
        <ul className="mt-3 flex w-full flex-col gap-1.5 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-2.5 py-2">
          {collisions.map((group) => (
            <li key={group.join("\0")} className="truncate font-mono text-[11px] text-[#e0e0e0]">
              {group.join("  ·  ")}
            </li>
          ))}
        </ul>
      )}

      {paths.length > 0 && (
        <ul className="mt-3 flex w-full flex-col rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5">
          {paths.map((p) => (
            <li key={p} className="truncate py-0.5 font-mono text-[11px] text-[#e0e0e0]">
              {p}
            </li>
          ))}
        </ul>
      )}

      {logTail.length > 0 && (
        <Collapsible className="mt-3 w-full">
          <CollapsibleTrigger className="group flex items-center gap-1 text-[12px] text-neutral-400 transition-colors hover:text-neutral-200">
            <ChevronRight size={12} className="transition-transform group-data-[state=open]:rotate-90" />
            Build log
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-48 w-full overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-black/30 p-2 font-mono text-[10.5px] leading-[1.5] text-neutral-400">
              {logTail.join("\n")}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}

      {stillFinishing && (
        <p className="mt-1.5 text-[12px] leading-[1.6] text-[#9a9a9a]">
          AntiDraw keeps trying in the background and lets you know how it turns out. You can
          close this.
        </p>
      )}

      {outcomeUnknown && check !== null && (
        <p className="mt-3 text-[12px] leading-[1.6] text-[#9a9a9a]">
          {check === "pending"
            ? "Not live yet. Check again in a moment."
            : check === "failed"
              ? "Couldn't check right now. Try again in a moment."
              : check === "ended"
                ? "This publish did not go live. Publish again."
                : "Couldn't tell whether this publish went live. Publish again to be sure."}
        </p>
      )}

      <button
        type="button"
        onClick={canCheck ? onCheckStatus : onRetry}
        disabled={checking}
        ref={buttonRef}
        className="mt-5 flex h-10 w-full items-center justify-center gap-2.5 rounded-[10px] border border-white/[0.12] bg-white/[0.08] text-sm font-medium text-[#e0e0e0] transition-colors hover:border-white/[0.24] hover:bg-white/[0.12] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-white/20 disabled:hover:border-white/[0.12] disabled:hover:bg-white/[0.08]"
      >
        {checking ? (
          <>
            <LoaderCircle size={15} className="animate-spin text-[#9a9a9a]" />
            <span className="text-[#9a9a9a]">Checking…</span>
          </>
        ) : canCheck ? (
          "Check status"
        ) : outcomeUnknown ? (
          "Publish again"
        ) : (
          "Try again"
        )}
      </button>
    </>
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
  const queryClient = useQueryClient();
  // The publish itself lives in publish-runs, per workspace; this component
  // only shows the active workspace's run. Sign-in is a panel of this view.
  const run = usePublishRuns((s) => s.runs[workspaceId]);
  // Tagged with its workspace, so a switch never shows it on another one.
  const [signInState, setSignInState] = useState<{ workspaceId: string; step: SignInStep } | null>(
    null,
  );
  const signInStep = signInState?.workspaceId === workspaceId ? signInState.step : null;
  const setSignInStep = (next: SignInStep | null | ((s: SignInStep | null) => SignInStep | null)) =>
    setSignInState((prev) => {
      const current = prev?.workspaceId === workspaceId ? prev.step : null;
      const step = typeof next === "function" ? next(current) : next;
      return step ? { workspaceId, step } : null;
    });
  const [linked, setLinked] = useState(false); // brief green beat before the modal closes
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [toastHeld, setToastHeld] = useState(false); // pointer on the toast
  // The pointer that clicked Publish is still on the button. The button turns
  // into Cancel under it, so until it leaves, a further click (a double-click,
  // or clicking again to see progress) must not land on Cancel.
  const [pointerHeld, setPointerHeld] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const publishButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Stable, so it runs once as a panel's button mounts, not on every render.
  const focusIfAtPublish = useCallback((el: HTMLButtonElement | null) => {
    if (el && panelTakesFocus(document.activeElement, publishButtonRef.current)) el.focus();
  }, []);
  const step: Step = signInStep ?? run?.phase ?? "closed";
  // For callbacks, which outlive the render that started them.
  const stepRef = useRef(step);
  const workspaceRef = useRef(workspaceId);
  useEffect(() => {
    stepRef.current = step;
    workspaceRef.current = workspaceId;
  });

  const { data: account } = useAccount();
  const signInMutation = useSignIn();
  const cancelSignInMutation = useCancelSignIn();
  const statusQuery = usePublishStatus(workspaceId);
  const setAllowRemixMutation = useSetAllowRemix();

  // Reads the conversation list only if something else already loaded it;
  // main's WORKSPACE_BUSY check is the authority, this just saves a click.
  const { data: conversations } = useQuery<Conversation[]>({
    queryKey: queryKeys.conversations.byWorkspace(workspaceId),
    queryFn: skipToken,
  });
  const agentBusy = !!conversations?.some((c) => c.streamStatus === "streaming");

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  const publish = (id: string) => {
    setLinked(false);
    setSignInStep(null);
    void startPublish(queryClient, id).then((outcome) => {
      if (outcome === "signed-out" && workspaceRef.current === id) setSignInStep("signin");
    });
  };

  // Ends the browser flow main is waiting on, if there is one.
  const abandonSignIn = () => {
    if (stepRef.current === "waiting") cancelSignInMutation.mutate();
  };

  // Leaving a workspace (or unmounting) ends its sign-in flow and pending
  // timers; its publish carries on in publish-runs.
  useEffect(
    () => () => {
      clear();
      abandonSignIn();
      setSignInState(null);
      setLinked(false);
      setDetailsOpen(false);
      setToastHeld(false);
      setPointerHeld(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId],
  );

  const publishing = run?.phase === "publishing" ? run : null;
  const canCancel = canCancelPublish(publishing) && !pointerHeld;

  const publishingLabel = publishing
    ? publishing.cancelling
      ? "Cancelling"
      : progressLabel(publishing.progress)
    : null;

  const onPublishClick = (e: React.MouseEvent) => {
    const action = publishClickAction(!!publishing, canCancel, e.detail);
    if (action === "cancel") void cancelPublishRun(workspaceId);
    if (action !== "start") return;
    clear();
    abandonSignIn();
    dismissPublishRun(workspaceId, { republishing: true });
    if (account) {
      // detail is 0 for a click from the keyboard: no pointer to hold.
      setPointerHeld(e.detail > 0);
      publish(workspaceId);
    } else {
      setLinked(false);
      setSignInStep("signin");
    }
  };

  const signIn = () => {
    clear();
    const id = workspaceId;
    setSignInStep("waiting");
    signInMutation.mutate(undefined, {
      onSuccess: () => {
        // Closed, cancelled or switched away while the browser was
        // finishing: stay signed in, don't publish.
        if (stepRef.current !== "waiting" || workspaceRef.current !== id) return;
        setLinked(true);
        later(LINKED_BEAT_MS, () => publish(id));
      },
      onError: (error) => {
        if (error.code === "CANCELLED") return;
        setSignInStep((s) => (s === "waiting" ? "error" : s));
      },
    });
  };

  const backToSignIn = () => {
    clear();
    abandonSignIn();
    setLinked(false);
    setSignInStep("signin");
  };

  const close = () => {
    clear();
    abandonSignIn();
    setLinked(false);
    setSignInStep(null);
    setToastHeld(false);
    dismissPublishRun(workspaceId);
  };

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  // The toast closes itself unless the pointer or the details hold it.
  useEffect(() => {
    if (step !== "published") {
      setToastHeld(false);
      return;
    }
    if (toastHeld || detailsOpen) return;
    const t = setTimeout(() => dismissPublishRun(workspaceId), PUBLISHED_TOAST_MS);
    return () => clearTimeout(t);
  }, [step, toastHeld, detailsOpen, workspaceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || linked || detailsOpen) return;
      if (step === "waiting") backToSignIn();
      else if (step === "signin" || step === "error") close();
      else if (step === "failed") {
        const focusInPanel = !!panelRef.current?.contains(document.activeElement);
        if (panelDismisses("escape", stillFinishing, focusInPanel)) close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const failed = !signInStep && run?.phase === "failed" ? run : null;
  const stillFinishing = !!failed && isStillFinishing(failed.error, failed.check);
  const published = !signInStep && run?.phase === "published" ? run : null;
  const result = published?.result ?? null;
  const modalOpen =
    step === "signin" || step === "waiting" || step === "error" || failed !== null;
  const allowRemix = statusQuery.data?.allowRemix ?? result?.allowRemix ?? true;
  const notIncluded = result ? countNotIncluded(result.excluded) : 0;
  const hasDetails =
    !!result && (notIncluded > 0 || result.site.skipped.length > 0 || result.notes.length > 0);

  return (
    <>
      <button
        ref={publishButtonRef}
        type="button"
        onClick={onPublishClick}
        onPointerLeave={() => setPointerHeld(false)}
        // A held Enter repeats the click; only its first press counts.
        onKeyDown={(e) => {
          if (e.repeat) e.preventDefault();
        }}
        disabled={agentBusy && !publishing}
        aria-label={
          publishingLabel !== null ? publishingName(publishingLabel, canCancel) : undefined
        }
        title={
          publishing
            ? canCancel
              ? "Cancel publishing"
              : undefined
            : agentBusy
              ? "Claude is still working"
              : undefined
        }
        className="group flex h-[26px] min-w-[84px] items-center justify-center gap-1.5 rounded-lg bg-[#e0e0e0] px-2.5 text-[13px] font-medium text-neutral-900 tabular-nums transition-colors hover:bg-white disabled:opacity-50 disabled:hover:bg-[#e0e0e0]"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {publishingLabel !== null ? (
          <PublishingLabel label={publishingLabel} canCancel={canCancel} />
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
      {/* The progress for screen readers: the button's name changes silently. */}
      <span role="status" aria-live="polite" className="sr-only">
        {publishing ? publishingAnnouncement(publishing.progress, publishing.cancelling) : ""}
      </span>

      {createPortal(
        <>
          {/* modal */}
          <AnimatePresence initial={false}>
            {modalOpen && (
              <motion.div
                className={cn(PANEL_CLASS, stillFinishing && "pointer-events-none")}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: EXIT }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
                onMouseDown={(e) => {
                  if (
                    e.target === e.currentTarget &&
                    step !== "waiting" &&
                    panelDismisses("backdrop", stillFinishing, false)
                  ) {
                    close();
                  }
                }}
              >
                <motion.div
                  ref={panelRef}
                  role={failed ? "alertdialog" : "dialog"}
                  aria-modal={!stillFinishing}
                  aria-labelledby={failed ? "publish-failed-title" : "publish-handshake-title"}
                  className={`pointer-events-auto relative flex ${failed ? "w-[360px]" : "w-[320px]"} origin-top-right flex-col items-start rounded-[14px] border border-[#2d2d2d] bg-[#2c2c2c] p-5 text-left shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)]`}
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

                  {failed ? (
                    <FailureContent
                      error={failed.error}
                      onRetry={() => publish(workspaceId)}
                      onCheckStatus={() => void checkPublishStatus(queryClient, workspaceId)}
                      checking={failed.checking}
                      check={failed.check}
                      buttonRef={focusIfAtPublish}
                    />
                  ) : (
                    <>
                      <img src={antidrawIcon} alt="AntiDraw" className="h-10 w-10" />

                      <h2 id="publish-handshake-title" className="mt-4 text-base font-medium tracking-[-0.01em] text-[#e0e0e0]">
                        Sign in to publish
                      </h2>
                      <p className="mt-1.5 text-[13px] leading-[1.6] text-[#9a9a9a]">
                        {step === "waiting"
                          ? "Finish signing in with Google in your browser. We'll publish right after."
                          : `Once you're signed in, ${workspaceName} goes live on a link you can share.`}
                      </p>

                      <button
                        type="button"
                        onClick={signIn}
                        disabled={step === "waiting"}
                        ref={focusIfAtPublish}
                        className="mt-5 flex h-10 w-full items-center justify-center gap-2.5 rounded-[10px] border border-white/[0.12] bg-white/[0.08] text-sm font-medium text-[#e0e0e0] transition-colors hover:border-white/[0.24] hover:bg-white/[0.12] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-white/20 disabled:hover:border-white/[0.12] disabled:hover:bg-white/[0.08]"
                      >
                        {linked ? (
                          <>
                            <Check size={15} strokeWidth={2.5} style={{ color: GREEN }} />
                            Connected
                          </>
                        ) : step === "waiting" ? (
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
                      {(step === "waiting" || step === "error") && (
                        <div className="mt-3 flex h-4 items-center text-[11px]">
                          {step === "waiting" ? (
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
                    </>
                  )}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* published toast */}
          <AnimatePresence>
            {published && (
              <motion.div
                className={TOAST_CLASS}
                initial={{ opacity: 0, y: reduce ? 0 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduce ? 0 : 4, transition: EXIT }}
                transition={SPRING}
                // Held open while the pointer is on it: it has controls now.
                onMouseEnter={() => setToastHeld(true)}
                onMouseLeave={() => setToastHeld(false)}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ background: tint(GREEN, 16), color: GREEN }}>
                    <Check size={11} strokeWidth={3} />
                  </span>
                  <span className="text-[13px] text-[#e0e0e0]">Published</span>
                  <span className="font-mono text-[11px] text-neutral-500">{published.url.replace(/^https?:\/\//, "")}</span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(published.url).catch(() => {});
                      setCopied(true);
                    }}
                    className="flex h-7 items-center gap-1.5 rounded-md bg-white/[0.08] px-2.5 text-[12px] font-medium text-neutral-200 transition-colors hover:bg-white/[0.12]"
                  >
                    {copied ? <Check size={12} style={{ color: GREEN }} /> : <Copy size={12} />}
                    {copied ? "Copied" : "Copy link"}
                  </button>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={close}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-neutral-300"
                  >
                    <X size={13} />
                  </button>
                </div>

                <div className="flex items-center gap-3 pl-8 text-[11px]">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={allowRemix}
                    disabled={setAllowRemixMutation.isPending || statusQuery.isFetching}
                    onClick={() =>
                      setAllowRemixMutation.mutate({ workspaceId, allowRemix: !allowRemix })
                    }
                    className="flex items-center gap-1.5 text-neutral-400 transition-colors hover:text-neutral-200 disabled:opacity-60"
                  >
                    <span
                      className="relative h-3 w-[22px] rounded-full transition-colors"
                      style={{ background: allowRemix ? tint(GREEN, 55) : "rgba(255,255,255,0.14)" }}
                    >
                      <span
                        className="absolute top-[2px] h-2 w-2 rounded-full bg-[#e0e0e0] transition-[left] duration-150"
                        style={{ left: allowRemix ? 12 : 2 }}
                      />
                    </span>
                    Allow remix
                  </button>
                  {setAllowRemixMutation.isError && (
                    <span style={{ color: RED }}>Couldn't change it</span>
                  )}
                  {hasDetails && (
                    <button
                      type="button"
                      onClick={() => setDetailsOpen(true)}
                      className="text-neutral-500 transition-colors hover:text-neutral-300"
                    >
                      {notIncluded > 0 ? `${notIncluded} files not included · ` : ""}Details
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {result && (
            <PublishDetails open={detailsOpen} onOpenChange={setDetailsOpen} result={result} />
          )}
        </>,
        document.body,
      )}
    </>
  );
};
