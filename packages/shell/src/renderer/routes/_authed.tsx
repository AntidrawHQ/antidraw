import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { isAuthenticated } from "@/renderer/lib/auth";
import { WorkspaceSwitcher } from "@/renderer/components/WorkspaceSwitcher";

export const Route = createFileRoute("/_authed")({
  beforeLoad: () => {
    if (!isAuthenticated()) {
      throw redirect({ to: "/login" });
    }
  },
  component: AuthedLayout,
});

const AuthedLayout = () => {
  return (
    <>
      {/* Draggable titlebar */}
      <div
        className="h-[38px] flex items-center w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d]"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="w-[180px] shrink-0" />
        <span className="flex-1 text-center text-[13px] font-medium text-neutral-400 tracking-tight">
          AntiDraw
        </span>
        <div className="w-[180px] shrink-0 flex justify-end pr-2 relative">
          <WorkspaceSwitcher />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <Outlet />
      </div>
    </>
  );
};
