import { useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { File as DiffsFile } from "@pierre/diffs/react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "../store/workspace";
import { useComponentSource } from "../store/userComponents";
import { CopyDropdown } from "./CopyDropdown";

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
      className={cn(
        "fixed top-[38px] right-0 bottom-0 w-[420px] flex flex-col bg-[#262626] border-l border-[#2d2d2d] z-[100] transition-transform duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
        isOpen
          ? "translate-x-0 pointer-events-auto"
          : "translate-x-full pointer-events-none"
      )}
    >
      <div className="flex items-center justify-between gap-3 p-3 pl-4 shrink-0">
        <span className="text-xs font-medium text-white/[0.88] overflow-hidden text-ellipsis whitespace-nowrap min-w-0">
          {fileName}
        </span>
        <div className="flex items-center gap-1.5">
          <CopyDropdown code={code} filePath={filePath} />
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 border-none bg-transparent text-white/30 cursor-pointer rounded-md hover:bg-white/[0.06] hover:text-white/50 transition-all duration-150"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="h-px bg-white/[0.06] shrink-0" />

      <div className="flex-1 min-h-0 overflow-hidden">
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
  const componentName = useWorkspaceStore((s) => s.codePanelComponentName);
  const setComponentName = useWorkspaceStore(
    (s) => s.setCodePanelComponentName
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
