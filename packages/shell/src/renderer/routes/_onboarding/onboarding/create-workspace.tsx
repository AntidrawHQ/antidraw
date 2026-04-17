import { useState, useEffect, useRef } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import {
  IconCircleCheckFilled,
  IconCircleHalf2,
} from "@tabler/icons-react";
import { useCreateWorkspace } from "@/renderer/lib/workspace-ops";

const c = {
  bg: "#262626",
  textPrimary: "#e0e0e0",
  textSecondary: "#9a9a9a",
  textMuted: "#666",
  btnBorder: "rgba(255,255,255,0.12)",
  btnBorderHover: "rgba(255,255,255,0.24)",
  btnText: "#ccc",
  btnPrimaryBg: "rgba(255,255,255,0.08)",
  btnPrimaryBgHover: "rgba(255,255,255,0.12)",
  active: "#e8a040",
  success: "#7c6cd6",
  pending: "#6b6b6b",
  fontSans:
    '"Geist Sans", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

type Status =
  | "idle"
  | "CREATING_DIRECTORY"
  | "SCAFFOLDING_PROJECT"
  | "INSTALLING_DEPENDENCIES"
  | "SAVING_WORKSPACE"
  | "done"
  | "error";

const STEPS = [
  { key: "CREATING_DIRECTORY", label: "Creating directory" },
  { key: "SCAFFOLDING_PROJECT", label: "Scaffolding project" },
  { key: "INSTALLING_DEPENDENCIES", label: "Installing dependencies" },
  { key: "SAVING_WORKSPACE", label: "Saving workspace" },
] as const;

const stepIndex = (s: Status): number => {
  const idx = STEPS.findIndex((st) => st.key === s);
  return s === "done" ? STEPS.length : idx;
};

const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path
      d="M6 3l5 5-5 5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ICON_SIZE = 18;

const CreateWorkspacePage = () => {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const isCreating = status !== "idle" && status !== "done" && status !== "error";
  const current = stepIndex(status);
  const { mutate: createWorkspace } = useCreateWorkspace();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    createWorkspace(
      {
        name: "Default Workspace",
        onProgress: (event) => {
          if (event.type === "status") {
            setStatus(event.status);
          }
          if (event.type === "done") {
            setStatus("done");
          }
          if (event.type === "error") {
            setStatus("error");
          }
        },
      },
    );
  }, [createWorkspace]);

  const handleOpenWorkspace = () => {
    router.navigate({ to: "/" });
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        background: c.bg,
        fontFamily: c.fontSans,
        WebkitFontSmoothing: "antialiased",
        padding: 24,
        paddingTop: 64,
        cursor: "default",
      }}
    >
      <style>{`
        @keyframes onb-spin { to { transform: rotate(360deg) } }
        @keyframes onb-fadein { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          maxWidth: 540,
          width: "100%",
        }}
      >
        <h1
          style={{
            fontSize: 28,
            fontWeight: 500,
            color: c.textPrimary,
            margin: 0,
            letterSpacing: "-0.04em",
          }}
        >
          {status === "done"
            ? "Workspace ready"
            : "Setting up your first workspace"}
        </h1>
        <p
          style={{
            fontSize: 14,
            color: c.textSecondary,
            margin: "10px 0 0",
            lineHeight: 1.6,
          }}
        >
          {status === "done" ? (
            <>
              Your workspace has been set up
              <br />
              and is ready to use.
            </>
          ) : (
            <>
              Everything is real code in Antidraw.
              <br />
              You design in code. There is no handoff.
            </>
          )}
        </p>

        {(isCreating || status === "done") && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 16,
              marginTop: 24,
              animation: "onb-fadein 0.3s ease",
            }}
          >
            {/* Steps */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                flex: 1,
                minWidth: 0,
              }}
            >
              {STEPS.map((step, i) => {
                const isDone = status === "done" || current > i;
                const isActive = status !== "done" && current === i;
                return (
                  <div
                    key={step.key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "10px 0",
                      opacity: isDone || isActive ? 1 : 0.35,
                      transition: "opacity 0.3s",
                    }}
                  >
                    <div style={{ display: "flex", flexShrink: 0 }}>
                      {isDone ? (
                        <IconCircleCheckFilled
                          size={ICON_SIZE}
                          strokeWidth={1.75}
                          color={c.success}
                        />
                      ) : isActive ? (
                        <IconCircleHalf2
                          size={ICON_SIZE}
                          strokeWidth={1.75}
                          color={c.active}
                          style={{
                            animation: "onb-spin 1s linear infinite",
                          }}
                        />
                      ) : (
                        <IconCircleHalf2
                          size={ICON_SIZE}
                          strokeWidth={1.75}
                          color={c.pending}
                        />
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 13,
                        color: isDone
                          ? c.textPrimary
                          : isActive
                            ? c.textPrimary
                            : c.textMuted,
                        fontWeight: isActive ? 500 : 400,
                      }}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}

              <button
                onClick={handleOpenWorkspace}
                disabled={status !== "done"}
                className="mt-6 w-fit flex items-center justify-center gap-2 px-4 py-2 rounded-[10px] border border-white/[0.12] hover:border-white/[0.24] bg-white/[0.08] hover:bg-white/[0.12] text-[#ccc] text-sm font-medium cursor-pointer disabled:cursor-default disabled:pointer-events-none transition-all duration-200 opacity-100 disabled:opacity-0"
              >
                Open workspace <ArrowRightIcon />
              </button>
            </div>

            {/* Grid — tight next to steps
            <div
              style={{
                flexShrink: 0,
                opacity: status === "done" ? 0 : 0.7,
                transition: "opacity 0.6s ease",
              }}
            >
              <MagneticGrid />
            </div>
            */}
          </div>
        )}
      </div>
    </div>
  );
};

export const Route = createFileRoute("/_onboarding/onboarding/create-workspace")({
  component: CreateWorkspacePage,
});
