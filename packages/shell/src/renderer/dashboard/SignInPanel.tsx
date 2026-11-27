import { Check, LoaderCircle } from "lucide-react";
import antidrawIcon from "@/renderer/assets/antidraw-icon.svg";

// The Published section, signed out: the publish popover's sign-in panel, set
// in the page where the list would be. It isn't anchored to anything here, so
// it has no close button; it's centred in the column like the other notices.
//
// Its states run as the popover's do: Sign in with Google → waiting for the
// browser (Cancel) → a brief Connected → the list. A failed sign-in keeps the
// panel, with Try again.

// The publish flow's colours: text, secondary text, the error's, and the done green.
const TEXT = "#e0e0e0";
const MUTED = "#9a9a9a";
const ERROR_TEXT = "#b98785";
const DONE = "#86D8A6";

const GoogleG = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" className="shrink-0" aria-hidden>
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export type SignInState = "signedOut" | "waiting" | "error";

export const SignInPanel = ({
  state,
  linked,
  onSignIn,
  onCancel,
}: {
  state: SignInState;
  // Signed in: "Connected" shows for a beat before the list.
  linked: boolean;
  onSignIn: () => void;
  onCancel: () => void;
}) => {
  const busy = state === "waiting";
  return (
    <div className="flex justify-center pt-20 pb-24">
      <div
        role="group"
        aria-labelledby="published-sign-in-title"
        className="flex w-[264px] flex-col items-start text-left"
      >
        <img src={antidrawIcon} alt="" className="h-7 w-7" />
        <h2
          id="published-sign-in-title"
          className="m-0 mt-3 text-[14px] font-medium tracking-[-0.01em]"
          style={{ color: TEXT }}
        >
          Sign in to see what you've published
        </h2>
        <p className="m-0 mt-1 text-[12px] leading-[1.45]" style={{ color: MUTED }}>
          {busy
            ? "Finish signing in with Google in your browser. Your sites show up here right after."
            : "Your published sites show up here with their links, once you're signed in."}
        </p>
        <button
          type="button"
          onClick={onSignIn}
          disabled={busy}
          className="mt-4 flex h-8 w-full cursor-pointer items-center justify-center gap-2 rounded-[8px] bg-[#e0e0e0] text-[12.5px] font-medium text-neutral-900 transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60 disabled:cursor-default disabled:hover:bg-[#e0e0e0]"
        >
          {linked ? (
            <>
              <span
                className="grid size-4 place-items-center rounded-full text-[#1C1C1C]"
                style={{ background: DONE }}
              >
                <Check size={10} strokeWidth={3} />
              </span>
              Connected
            </>
          ) : busy ? (
            <>
              <LoaderCircle size={13} className="animate-spin text-neutral-600" />
              <span className="text-neutral-600">Waiting for Google…</span>
            </>
          ) : (
            <>
              <GoogleG size={14} />
              {state === "error" ? "Try again" : "Sign in with Google"}
            </>
          )}
        </button>
        {(busy || state === "error") && (
          <div className="mt-2.5 flex min-h-4 items-center text-[12px]">
            {busy ? (
              <button
                type="button"
                onClick={onCancel}
                disabled={linked}
                className="cursor-pointer text-neutral-400 transition-colors hover:text-neutral-200 disabled:opacity-0"
              >
                Cancel
              </button>
            ) : (
              <span role="alert" className="leading-[1.5]" style={{ color: ERROR_TEXT }}>
                Couldn't connect to Google. Try again.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
