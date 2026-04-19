import { RefreshCw } from "lucide-react";
import claudeLogo from "@/renderer/assets/claude-color.svg";

type AuthErrorProps = {
  onSignIn: () => void;
  onRetry: () => void;
};

export const AuthError = ({ onSignIn, onRetry }: AuthErrorProps) => (
  <div className="py-3.5">
    <p className="text-sm font-medium text-neutral-200 leading-normal mb-1">
      You're not signed in to Claude Code.
    </p>
    <p className="text-sm text-neutral-500 leading-normal mb-3">
      Sign in below to open a login window. Once you're done, come back and
      retry your message.
    </p>

    <div className="flex flex-col gap-1">
      <button
        onClick={onSignIn}
        className="flex items-center justify-center gap-1.5 py-2 px-3.5 bg-white/[0.06] border border-white/[0.1] rounded-md cursor-pointer text-sm font-medium text-neutral-200 transition-colors w-full box-border hover:bg-white/[0.1]"
      >
        <img
          src={claudeLogo}
          alt="Claude"
          className="w-[13px] h-[13px] shrink-0"
        />
        Sign in to Claude Code
      </button>
      <button
        onClick={onRetry}
        className="flex items-center justify-center gap-1.5 py-2 px-3.5 bg-transparent border border-transparent rounded-md cursor-pointer text-sm text-neutral-500 transition-colors w-full box-border hover:text-neutral-400"
      >
        <RefreshCw size={13} />
        Retry Message
      </button>
    </div>
  </div>
);
