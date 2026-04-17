import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import antidrawLogo from "@/renderer/assets/antidraw-logo.png";

const LoginPage = () => {
  const router = useRouter();

  const handleSignIn = () => {
    router.navigate({ to: "/onboarding/create-workspace" });
  };

  return (
    <div className="flex h-full w-full items-start justify-center bg-neutral-800 p-6 pt-16 cursor-default antialiased">
      <div className="flex flex-col max-w-[540px] w-full">
        <img src={antidrawLogo} alt="Antidraw" className="w-10 h-10 rounded-lg mb-5" />
        <h1 className="text-[28px] font-medium text-[#e0e0e0] m-0">
          Welcome to
          <br />
          AntiDraw
        </h1>
        <p className="text-sm text-[#9a9a9a] mt-2.5 leading-relaxed">
          An infinite design canvas for your coding agents.
        </p>
        <button
          onClick={handleSignIn}
          className="mt-8 w-fit flex items-center justify-center gap-2 py-2 px-4 rounded-[10px] border border-white/12 bg-[rgba(255,255,255,0.08)] text-[#ccc] text-sm font-medium cursor-pointer transition-all duration-200 ease-out hover:bg-[rgba(255,255,255,0.12)] hover:border-white/24"
        >
          Create your first workspace!
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};

export const Route = createFileRoute("/login")({
  component: LoginPage,
});
