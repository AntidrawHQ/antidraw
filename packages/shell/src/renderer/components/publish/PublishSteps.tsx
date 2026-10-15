/**
 * The publish run as a step list, built the way CreateWorkspaceProgress is:
 * icon + label per step, and whatever the active step needs opens inline
 * under it, indented to the label. Building streams vite's output into the
 * same mini terminal npm install uses; uploading swaps it for a progress bar;
 * a failed step keeps its output open and offers the fix that matches the
 * failure. Signing in isn't a step: the sign-in panel handles it before the
 * run starts.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Check } from "lucide-react";
import {
  C,
  CheckCircle,
  HalfCircle,
  STEPS,
  SmallButton,
  XCircle,
  cx,
  lineTone,
  stepIndex,
  uploaded,
  type PublishState,
  type StepKey,
} from "./shared";

export type StepActions = {
  /** The confirm panel's Publish button: starts the run. */
  onPublish?: () => void;
  onRetry?: () => void;
  onAskClaude?: () => void;
};

/** Opens and closes its content by height, like the install log. */
const Reveal = ({ open, children }: { open: boolean; children: ReactNode }) => (
  <div
    className={cx(
      "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
      open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
    )}
  >
    <div className="overflow-hidden">
      <div className="pb-2 pl-[28px]">{children}</div>
    </div>
  </div>
);

export const Terminal = ({ lines, failed, height = 96 }: { lines: string[]; failed?: boolean; height?: number }) => {
  const ref = useRef<HTMLDivElement>(null);
  // Pin to the bottom as lines stream in; on failure, to where the error starts
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const first = failed ? lines.findIndex((l) => lineTone(l) === C.errorLog) : -1;
    const row = first > 0 ? (el.children[first] as HTMLElement | undefined) : undefined;
    el.scrollTop = row ? row.offsetTop - 8 : el.scrollHeight;
  }, [lines, failed]);
  return (
    <div
      ref={ref}
      className={cx(
        "overflow-y-auto rounded-md border px-3 py-2 transition-colors duration-300 [scrollbar-width:none]",
        failed ? "border-[#d9605c]/25" : "border-white/[0.07]",
      )}
      style={{ height }}
    >
      {lines.map((line, j) => (
        <span
          key={j}
          className={cx("block font-mono text-[11px] leading-[1.7]", failed ? "whitespace-pre-wrap break-all" : "truncate")}
          style={{ color: j === lines.length - 1 && !failed ? C.logLast : lineTone(line) }}
          title={line}
        >
          {line || " "}
        </span>
      ))}
    </div>
  );
};

const UploadBar = ({ upload, failed }: { upload: NonNullable<PublishState["upload"]>; failed?: boolean }) => {
  const pct = Math.round(uploaded(upload) * 100);
  return (
    <div
      className={cx(
        "rounded-md border px-3 py-2.5 transition-colors duration-300",
        failed ? "border-[#d9605c]/25" : "border-white/[0.07]",
      )}
    >
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="min-w-0 truncate font-mono" style={{ color: failed ? C.errorLog : C.logLast }}>
          {failed ? `stopped at ${upload.file}` : upload.done === upload.total ? "all files sent" : upload.file}
        </span>
        <span className="shrink-0 font-mono tabular-nums" style={{ color: C.muted }}>
          {upload.done}/{upload.total}
        </span>
      </div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%`, background: failed ? C.error : C.active }}
        />
      </div>
      {upload.unchanged > 0 && (
        <p className="m-0 mt-2 text-[11px]" style={{ color: C.muted }}>
          {upload.unchanged} unchanged files already live, skipped
        </p>
      )}
    </div>
  );
};

const FailureRow = ({ state, actions }: { state: PublishState; actions: StepActions }) => {
  const f = state.failure!;
  return (
    <div className="flex flex-col gap-2.5 pb-2 pl-[28px] animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <span role="alert" className="text-[12px] leading-[1.5]" style={{ color: C.errorText }}>
        {f.message}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {f.kind === "BUILD_FAILED" ? (
          <>
            <SmallButton primary onClick={actions.onAskClaude} disabled={state.sentToClaude}>
              {state.sentToClaude && <Check size={12} strokeWidth={2.5} style={{ color: C.green }} />}
              {state.sentToClaude ? "Sent to agent" : "Ask agent"}
            </SmallButton>
            <SmallButton onClick={actions.onRetry}>Try again</SmallButton>
          </>
        ) : (
          <SmallButton onClick={actions.onRetry}>
            {f.kind === "UPLOAD_FAILED" ? "Resume upload" : "Try again"}
          </SmallButton>
        )}
      </div>
    </div>
  );
};

export default function PublishSteps({ state, actions = {} }: { state: PublishState; actions?: StepActions }) {
  const current = stepIndex(state);
  const failed = state.failure;
  const done = state.step === "done";

  const announcement = done
    ? `${state.site.name} is live`
    : failed
      ? `${STEPS[current]?.label} failed`
      : `${STEPS[current]?.label}…`;

  return (
    <div className="flex flex-col">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {STEPS.map((step, i) => {
        const isFailed = !!failed && current === i;
        const isDone = !isFailed && (done || current > i);
        const isActive = !failed && !done && current === i;
        const meta = state.meta[step.key];

        const body = bodyFor(step.key, { state, isActive, isFailed });

        return (
          <div key={step.key}>
            <div
              className={cx(
                "flex items-center gap-2.5 py-2 transition-opacity duration-300",
                isDone || isActive || isFailed ? "opacity-100" : "opacity-35",
              )}
            >
              <div className="flex shrink-0">
                {isFailed ? <XCircle /> : isDone ? <CheckCircle /> : <HalfCircle active={isActive} />}
              </div>
              <span
                className={cx("text-[13px]", (isActive || isFailed) && "font-medium")}
                style={{ color: isDone || isActive || isFailed ? C.text : C.dim }}
              >
                {step.label}
              </span>
              {meta && isDone && (
                <span
                  className="ml-auto min-w-0 truncate pl-3 font-mono text-[11px] animate-in fade-in-0 duration-300"
                  style={{ color: C.muted }}
                >
                  {meta}
                </span>
              )}
              {isActive && step.key === "upload" && state.upload && (
                <span className="ml-auto pl-3 font-mono text-[11px] tabular-nums" style={{ color: C.muted }}>
                  {Math.round(uploaded(state.upload) * 100)}%
                </span>
              )}
            </div>

            <Reveal open={!!body}>{body}</Reveal>

            {isFailed ? <FailureRow state={state} actions={actions} /> : null}
          </div>
        );
      })}
    </div>
  );
}

function bodyFor(
  key: StepKey,
  { state, isActive, isFailed }: { state: PublishState; isActive: boolean; isFailed: boolean },
): ReactNode {
  if (!isActive && !isFailed) return null;
  if (key === "build" && state.log.length)
    return <Terminal lines={state.log} failed={isFailed} height={isFailed ? 168 : 96} />;
  if (key === "upload" && state.upload) return <UploadBar upload={state.upload} failed={isFailed} />;
  return null;
}
