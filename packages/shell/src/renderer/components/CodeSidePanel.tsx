import { useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { File as DiffsFile } from "@pierre/diffs/react";
import { useWorkspaceStore } from "../store/workspace";
import { useComponentSource } from "../store/userComponents";
import { CopyDropdown } from "./CopyDropdown";

const PANEL_WIDTH = 420;

const DIFFS_OPTIONS = {
  theme: "houston" as const,
  overflow: "scroll" as const,
  disableFileHeader: true,
  unsafeCSS: `pre, code, [data-file], [data-code] { background-color: #262626 !important; background: #262626 !important; }`,
};

const DIFFS_STYLE = {
  height: "100%",
  overflow: "auto",
  "--diffs-bg": "#262626",
  "--diffs-dark-bg": "#262626",
  "--diffs-light-bg": "#262626",
} as React.CSSProperties;

const Sidebar = ({
  isOpen,
  onClose,
  code,
  fileName,
  filePath,
}: {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  fileName: string;
  filePath: string;
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  return (
    <div
      style={{
        position: "fixed",
        top: 38,
        right: 0,
        bottom: 0,
        width: PANEL_WIDTH,
        display: "flex",
        flexDirection: "column",
        background: "#262626",
        borderLeft: "1px solid #2d2d2d",
        zIndex: 100,
        transform: isOpen ? "translateX(0)" : "translateX(100%)",
        transition: "transform 320ms cubic-bezier(0.16, 1, 0.3, 1)",
        pointerEvents: isOpen ? "auto" : "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 12px 12px 16px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "rgba(255,255,255,0.88)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {fileName}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <CopyDropdown code={code} filePath={filePath} />
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 border-none bg-transparent text-white/30 cursor-pointer rounded-md hover:bg-white/[0.06] hover:text-white/50 transition-all duration-150"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Separator */}
      <div
        style={{
          height: 1,
          background: "rgba(255,255,255,0.06)",
          flexShrink: 0,
        }}
      />

      {/* Code body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        <DiffsFile
          file={{ name: fileName, contents: code }}
          options={DIFFS_OPTIONS}
          style={DIFFS_STYLE}
        />
      </div>
    </div>
  );
};

export const CodeSidePanel = () => {
  const componentName = useWorkspaceStore((s) => s.codeModalComponentName);
  const setComponentName = useWorkspaceStore(
    (s) => s.setCodeModalComponentName
  );
  const { data: sourceData } = useComponentSource(componentName);

  const isOpen = componentName !== null;
  const handleClose = useCallback(
    () => setComponentName(null),
    [setComponentName]
  );

  return (
    <Sidebar
      isOpen={isOpen && !!sourceData}
      onClose={handleClose}
      code={sourceData?.source ?? ""}
      fileName={sourceData?.fileName ?? `${componentName ?? ""}.tsx`}
      filePath={sourceData?.filePath ?? ""}
    />
  );
};
