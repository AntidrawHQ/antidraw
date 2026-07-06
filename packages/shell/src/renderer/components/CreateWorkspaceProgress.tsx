import { useEffect, useRef } from "react";
import type { CreateWorkspaceStatusCode } from "@/main/api";
import type { CreateWorkspaceStatus } from "@/renderer/lib/use-create-workspace-flow";

// Inline log: the mini terminal renders inside the active step itself,
// indented to align with the step label. No fill — just a very subtle border.
// Auto-scrolls as npm output streams in. On error the failed step gets a red
// X, the log stays open with npm ERR! lines tinted, and a retry affordance
// appears under the failed step.

const STEPS = [
  { key: "CREATING_DIRECTORY", label: "Creating directory" },
  { key: "SCAFFOLDING_PROJECT", label: "Scaffolding project" },
  { key: "INSTALLING_DEPENDENCIES", label: "Installing dependencies" },
  { key: "SAVING_WORKSPACE", label: "Saving workspace" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const ICON_SIZE = 18;

const CheckCircleIcon = () => (
  <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="#7c6cd6">
    <path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z" />
  </svg>
);

const XCircleIcon = () => (
  <svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="#d9605c">
    <path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-6.489 5.8a1 1 0 0 0 -1.218 1.567l1.292 1.293l-1.292 1.293l-.083 .094a1 1 0 0 0 1.497 1.32l1.293 -1.292l1.293 1.292l.094 .083a1 1 0 0 0 1.32 -1.497l-1.292 -1.293l1.292 -1.293l.083 -.094a1 1 0 0 0 -1.497 -1.32l-1.293 1.292l-1.293 -1.292l-.094 -.083z" />
  </svg>
);

const HalfCircleIcon = ({ active }: { active: boolean }) => (
  <svg
    width={ICON_SIZE}
    height={ICON_SIZE}
    viewBox="0 0 24 24"
    fill="none"
    stroke={active ? "#e8a040" : "#6b6b6b"}
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={active ? "animate-spin" : undefined}
  >
    <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18z" />
    <path d="M12 3v18" />
    <path d="M12 14l7 -7" />
    <path d="M12 19l8.5 -8.5" />
    <path d="M12 9l4.5 -4.5" />
  </svg>
);

const stepIndex = (
  status: CreateWorkspaceStatus,
  failedStep: CreateWorkspaceStatusCode | null,
): number =>
  status === "done"
    ? STEPS.length
    : status === "error"
      ? STEPS.findIndex((s) => s.key === failedStep)
      : STEPS.findIndex((s) => s.key === status);

const STREAMING_STEPS: StepKey[] = [
  "SCAFFOLDING_PROJECT",
  "INSTALLING_DEPENDENCIES",
];

const lineTone = (line: string): string =>
  line.startsWith("npm ERR!")
    ? "text-[#e08a86]"
    : /attempt \d+ failed/.test(line)
      ? "text-[#c99a62]"
      : "text-[#7f7f7f]";

export const CreateWorkspaceProgress = ({
  status,
  lines,
  failedStep,
  errorMessage,
  onRetry,
}: {
  status: CreateWorkspaceStatus;
  lines: string[];
  failedStep: CreateWorkspaceStatusCode | null;
  errorMessage: string | null;
  onRetry: () => void;
}) => {
  const hasError = status === "error";
  const current = stepIndex(status, failedStep);
  const logRef = useRef<HTMLDivElement>(null);

  // Pin the log to the bottom as new lines stream in
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="flex flex-col">
      {STEPS.map((step, i) => {
        const isFailed = hasError && current === i;
        const isDone = !isFailed && (status === "done" || current > i);
        const isActive = !hasError && status !== "done" && current === i;
        const showLog =
          (isActive || isFailed) &&
          STREAMING_STEPS.includes(step.key) &&
          lines.length > 0;

        return (
          <div key={step.key}>
            <div
              className={
                "flex items-center gap-2.5 py-2.5 transition-opacity duration-300 " +
                (isDone || isActive || isFailed ? "opacity-100" : "opacity-35")
              }
            >
              <div className="flex shrink-0">
                {isFailed ? (
                  <XCircleIcon />
                ) : isDone ? (
                  <CheckCircleIcon />
                ) : (
                  <HalfCircleIcon active={isActive} />
                )}
              </div>
              <span
                className={
                  "text-[13px] " +
                  (isFailed
                    ? "font-medium text-[#e0e0e0]"
                    : isDone || isActive
                      ? "text-[#e0e0e0] "
                      : "text-[#666] ") +
                  (isActive ? "font-medium" : "")
                }
              >
                {step.label}
              </span>
            </div>

            {STREAMING_STEPS.includes(step.key) ? (
              <div
                className={
                  "grid transition-[grid-template-rows,opacity] duration-300 ease-out " +
                  (showLog
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0")
                }
              >
                <div className="overflow-hidden">
                  <div className="pb-2 pl-[28px]">
                    <div
                      ref={isActive || isFailed ? logRef : undefined}
                      className={
                        "h-[96px] overflow-y-auto rounded-md border px-3 py-2 transition-colors duration-300 " +
                        (isFailed
                          ? "border-[#d9605c]/25"
                          : "border-white/[0.07]")
                      }
                    >
                      {lines.map((line, j) => (
                        <span
                          key={j}
                          className={
                            "block truncate font-mono text-[11px] leading-[1.7] " +
                            (j === lines.length - 1 && !isFailed
                              ? "text-[#c5c5c5]"
                              : lineTone(line))
                          }
                        >
                          {line}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {isFailed ? (
              <div className="flex items-center justify-between gap-3 pb-2 pl-[28px] animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
                <span className="text-[12px] leading-[1.5] text-[#b98785]">
                  {errorMessage}
                </span>
                <button
                  type="button"
                  onClick={onRetry}
                  className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.06] px-2.5 py-1 text-[12px] font-medium text-[#e0e0e0] transition-colors hover:bg-white/[0.1]"
                >
                  Try again
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
