import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import antidrawLogo from "@/renderer/assets/antidraw-logo.png";
import claudeLogo from "@/renderer/assets/claude-color.svg";
import {
  WavyVerticalLine,
  WavyHorizontalLine,
} from "@/renderer/components/onboarding/wavy-lines";

const ClaudeCodePage = () => {
  const router = useRouter();

  const handleContinue = () => {
    router.navigate({ to: "/onboarding/create-workspace" });
  };

  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-800 relative overflow-hidden p-6 cursor-default antialiased">
      <div className="relative z-10 flex flex-col w-full max-w-[380px]">
        <WavyVerticalLine />

        <div className="mb-5">
          <img src={claudeLogo} alt="Claude" className="w-12 h-12" />
        </div>

        <h1 className="text-[30px] font-medium text-[#e0e0e0] m-0 tracking-[-0.04em]">
          Claude Code connected
        </h1>
        <p className="text-sm text-[#9a9a9a] mt-2.5 leading-relaxed">
          You're all set. Claude is ready to go.
        </p>

        <WavyHorizontalLine />

        {/* Conversation */}
        <div className="flex flex-col gap-3">
          {/* Antidraw message */}
          <div className="flex items-start gap-2.5">
            <img
              src={antidrawLogo}
              alt="Antidraw"
              className="w-7 h-7 rounded-lg shrink-0 mt-0.5"
            />
            <div className="bg-white/5 rounded-xl rounded-bl-[4px] px-3.5 py-2.5 text-[13px] text-[#e0e0e0] leading-normal">
              Hey Claude, it&apos;s Antidraw — the design agent.
              <br />
              Are you up?
            </div>
          </div>

          {/* Claude response */}
          <div
            className="flex items-start gap-2.5 animate-in fade-in-0"
            style={{ animationDuration: "300ms" }}
          >
            <img
              src={claudeLogo}
              alt="Claude"
              className="w-7 h-7 shrink-0 mt-0.5"
            />
            <div className="bg-white/5 rounded-xl rounded-bl-[4px] px-3.5 py-2.5 text-[13px] text-[#e0e0e0] leading-normal">
              Hey! I&apos;m here. Ready when you are.
            </div>
          </div>
        </div>

        {/* Continue */}
        <button
          onClick={handleContinue}
          className="mt-6 w-full flex items-center justify-center gap-2 py-3 px-5 rounded-[10px] border border-white/12 bg-white/[0.08] text-[#ccc] text-sm font-medium cursor-pointer transition-all duration-200 ease-out hover:bg-white/[0.12] hover:border-white/24 animate-in fade-in-0"
          style={{ animationDuration: "300ms" }}
        >
          Continue
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_authed/onboarding/claude-code")({
  component: ClaudeCodePage,
});
