import { forwardRef } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { cn } from "@/renderer/lib/utils";

// The one Sign in with Google button: the dashboard's Published panel's and
// the Publish popover's. Its label carries every state: Sign in (or Try
// again), Waiting for Google… while the browser has it, Checking…, and a
// beat of Connected.
//
// Inactive is aria-disabled, not disabled: a click does nothing, and keyboard
// focus stays on it, as the popover traps focus and gives it back here.

// The publish flow's done green.
const DONE = "#86D8A6";

export type GoogleSignInStatus = "idle" | "waiting" | "checking" | "connected";

export const GoogleG = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" className="shrink-0" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export const GoogleSignInButton = forwardRef<
  HTMLButtonElement,
  {
    status: GoogleSignInStatus;
    onClick: () => void;
    // What it says when it can be clicked.
    label?: string;
    // The Google mark beside it: not on a Try again that publishes.
    google?: boolean;
    // Can't be clicked, whatever it says.
    inactive?: boolean;
    className?: string;
  }
>(({ status, onClick, label = "Sign in with Google", google = true, inactive = false, className }, ref) => {
  const off = inactive || status !== "idle";
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => !off && onClick()}
      aria-disabled={off || undefined}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-[#e0e0e0] text-[12.5px] font-medium text-neutral-900 transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 aria-disabled:cursor-default aria-disabled:hover:bg-[#e0e0e0]",
        className,
      )}
    >
      {status === "connected" ? (
        <>
          <span className="grid size-4 place-items-center rounded-full text-[#1C1C1C]" style={{ background: DONE }}>
            <Check size={10} strokeWidth={3} />
          </span>
          Connected
        </>
      ) : status === "waiting" || status === "checking" ? (
        <>
          <LoaderCircle size={13} className="animate-spin text-neutral-600" />
          <span className="text-neutral-600">{status === "waiting" ? "Waiting for Google…" : "Checking…"}</span>
        </>
      ) : (
        <>
          {google && <GoogleG size={14} />}
          {label}
        </>
      )}
    </button>
  );
});
GoogleSignInButton.displayName = "GoogleSignInButton";
