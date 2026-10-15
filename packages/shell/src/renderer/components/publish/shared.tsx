/**
 * What the publish flow shares: the shell's dark palette, the step icons from
 * CreateWorkspaceProgress (so publishing and installing read as one system),
 * and the state model the panel renders.
 *
 * The steps mirror packages/shell/src/main/services/publish.ts: the account,
 * checkRuntime, build (`vite build`), uploadSite, then the site going live.
 */
import type { ReactNode } from "react";

/* ── Tokens (packages/shell renderer) ──────────────────────────────────── */

export const C = {
  panel: "#2c2c2c",
  panelBorder: "#3a3a3a",
  text: "#e0e0e0",
  // Secondary text. The dimmest gray that stays readable (4.96:1 on panel).
  muted: "#9a9a9a",
  // Upcoming steps only, faded further by opacity, as in the install flow.
  dim: "#666",
  log: "#7f7f7f",
  logLast: "#c5c5c5",
  done: "#7c6cd6",
  active: "#e8a040",
  error: "#d9605c",
  errorText: "#b98785",
  errorLog: "#e08a86",
  warnLog: "#c99a62",
  green: "oklch(0.696 0.17 162.48)",
};

export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const SPRING = { type: "spring" as const, visualDuration: 0.18, bounce: 0 };
export const EXIT = { duration: 0.12, ease: EASE_OUT };

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ── Model ─────────────────────────────────────────────────────────────── */

export const STEPS = [
  { key: "account", label: "Checking account" },
  { key: "runtime", label: "Checking runtime" },
  { key: "build", label: "Building site" },
  { key: "upload", label: "Uploading files" },
  { key: "live", label: "Going live" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

/**
 * publish.ts's PublishError codes, or another failure's. SIGNED_OUT never
 * shows here: the sign-in panel takes it.
 */
export type FailureKind = "RUNTIME_TOO_OLD" | "BUILD_FAILED" | "UPLOAD_FAILED" | "SERVER_ERROR" | (string & {});

/** `detail` is what came after the message's first line: a build's error. */
export type Failure = { step: StepKey; kind: FailureKind; message: string; detail?: string };

export type PublishState = {
  site: { name: string; url: string | null; lastPublished?: string };
  /** "confirm" before anything runs, then the step running now, then "done" once live. */
  step: StepKey | "done" | "confirm";
  failure?: Failure;
  /** Right-hand detail on finished steps. */
  meta: Partial<Record<StepKey, string>>;
  /** Streaming output of the active (or failed) step: vite. */
  log: string[];
  upload?: { done: number; total: number; unchanged: number; file: string };
  /** Build failure handed to the agent. */
  sentToClaude?: boolean;
};

export const stepIndex = (s: PublishState) =>
  s.step === "confirm"
    ? -1
    : s.step === "done"
      ? STEPS.length
      : STEPS.findIndex((x) => x.key === (s.failure?.step ?? s.step));

/** How far an upload is, 0–1. One with nothing to send is done. */
export const uploaded = (u: NonNullable<PublishState["upload"]>) => (u.total ? u.done / u.total : 1);

/** 0–1 across the whole run, for the titlebar ring. */
export const progressOf = (s: PublishState) => {
  if (s.step === "done") return 1;
  if (s.step === "confirm") return 0;
  const weights: Record<StepKey, number> = { account: 0.05, runtime: 0.05, build: 0.45, upload: 0.4, live: 0.05 };
  let p = 0;
  for (const { key } of STEPS) {
    if (key === s.step) {
      const inner =
        key === "upload" && s.upload ? uploaded(s.upload) : key === "build" ? Math.min(s.log.length / 9, 1) : 0.3;
      return p + weights[key] * inner;
    }
    p += weights[key];
  }
  return p;
};

export const lineTone = (line: string) =>
  /^npm (error|ERR!)|^error during build|^✗|^\s*(src|node_modules)\/.*:\s|Error:/.test(line)
    ? C.errorLog
    : /^npm warn|deprecated|attempt \d+ failed/i.test(line)
      ? C.warnLog
      : C.log;

/* ── Icons (CreateWorkspaceProgress) ───────────────────────────────────── */

const ICON = 18;

export const CheckCircle = ({ color = C.done, size = ICON }: { color?: string; size?: number }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z" />
  </svg>
);

export const XCircle = ({ size = ICON }: { size?: number }) => (
  <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill={C.error}>
    <path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-6.489 5.8a1 1 0 0 0 -1.218 1.567l1.292 1.293l-1.292 1.293l-.083 .094a1 1 0 0 0 1.497 1.32l1.293 -1.292l1.293 1.292l.094 .083a1 1 0 0 0 1.32 -1.497l-1.292 -1.293l1.292 -1.293l.083 -.094a1 1 0 0 0 -1.497 -1.32l-1.293 1.292l-1.293 -1.292l-.094 -.083z" />
  </svg>
);

export const HalfCircle = ({ active, color = C.active }: { active: boolean; color?: string }) => (
  <svg
    aria-hidden
    width={ICON}
    height={ICON}
    viewBox="0 0 24 24"
    fill="none"
    stroke={active ? color : "#6b6b6b"}
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={active ? "animate-spin" : undefined}
    style={active ? { animationDuration: "1.4s" } : undefined}
  >
    <path d="M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18z" />
    <path d="M12 3v18" />
    <path d="M12 14l7 -7" />
    <path d="M12 19l8.5 -8.5" />
    <path d="M12 9l4.5 -4.5" />
  </svg>
);

/** Little pill-ish secondary button, as in the install flow's "Try again". */
export const SmallButton = ({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
}) => (
  <button
    type="button"
    onClick={disabled ? undefined : onClick}
    aria-disabled={disabled}
    className={cx(
      "flex h-[26px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors aria-disabled:cursor-default",
      primary
        ? "border-transparent bg-[#e0e0e0] text-neutral-900 hover:bg-white"
        : "border-white/[0.08] bg-white/[0.06] text-[#e0e0e0] hover:bg-white/[0.1]",
    )}
  >
    {children}
  </button>
);
