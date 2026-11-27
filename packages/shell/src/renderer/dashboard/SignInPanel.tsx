import antidrawIcon from "@/renderer/assets/antidraw-icon.svg";
import { GoogleSignInButton } from "@/renderer/components/GoogleSignInButton";

// The Published section, signed out: the publish popover's sign-in panel, set
// in the page where the list would be. It isn't anchored to anything here, so
// it has no close button; it's centred in the column like the other notices.
//
// Its states run as the popover's do: Sign in with Google → waiting for the
// browser (Cancel) → a brief Connected → the list. A failed sign-in keeps the
// panel, with Try again.

// The publish flow's colours: text, secondary text, and the error's.
const TEXT = "#e0e0e0";
const MUTED = "#9a9a9a";
const ERROR_TEXT = "#b98785";

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
        <GoogleSignInButton
          status={linked ? "connected" : busy ? "waiting" : "idle"}
          label={state === "error" ? "Try again" : undefined}
          onClick={onSignIn}
          className="mt-4"
        />
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
