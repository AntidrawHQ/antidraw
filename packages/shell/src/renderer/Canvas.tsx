import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect } from "react";
import { useUserComponents, useUserComponentsWatcher } from "./store/userComponents";
import { useWorkspaceStore } from "./store/workspace";
import { useDevServerStatus, useAutoStartDevServer } from "./lib/workspace-ops";
import { useFrameLayouts } from "./lib/frame-layout-ops";
import { saveFrameLayouts, type FrameLayoutData } from "./lib/api";
import { cn } from "./lib/utils";
import { Canvas, GridPattern, useFocusComponent, type FrameLayout } from "./canvas/Canvas";
import { EmptyState } from "./components/EmptyState";

// Focus on component when clicked in ComponentPanel
const FocusRequestedComponent = () => {
  const focusComponent = useFocusComponent();
  const focusComponentName = useWorkspaceStore((s) => s.focusComponentName);
  const setFocusComponentName = useWorkspaceStore((s) => s.setFocusComponentName);

  useEffect(() => {
    if (focusComponentName) {
      focusComponent(focusComponentName);
      setFocusComponentName(null);
    }
  }, [focusComponentName, focusComponent, setFocusComponentName]);

  return null;
};

const openFullscreen = (url: string) => {
  window.electronAPI.openPreviewWindow(url);
};

const WorkspaceCanvas = ({
  workspaceId,
  userComponents,
  port,
  savedLayouts,
  className,
}: {
  workspaceId: string;
  userComponents: { name: string }[];
  port: number;
  savedLayouts: FrameLayoutData[] | undefined;
  className?: string;
}) => {
  const setCodePanelComponentName = useWorkspaceStore((s) => s.setCodePanelComponentName);

  const frameUrl = useCallback(
    (componentName: string) =>
      `https://localhost:${port}/preview?componentName=${encodeURIComponent(componentName)}`,
    [port],
  );

  const saveLayouts = useCallback(
    (layouts: FrameLayout[]) => {
      saveFrameLayouts(workspaceId, layouts); // fire-and-forget
    },
    [workspaceId],
  );

  return (
    <Canvas
      components={userComponents}
      savedLayouts={savedLayouts}
      frameUrl={frameUrl}
      onLayoutsChange={saveLayouts}
      onFullscreen={openFullscreen}
      onSeeCode={setCodePanelComponentName}
      className={className}
    >
      <FocusRequestedComponent />
    </Canvas>
  );
};

type CanvasPlaceholderProps = {
  subtitle: string;
  className?: string;
};

const CanvasPlaceholder = ({ subtitle, className }: CanvasPlaceholderProps) => (
  <div className={cn("flex-1 flex items-center justify-center bg-neutral-800 relative", className)}>
    <GridPattern />
    <div className="text-center z-10">
      <div className="text-sm text-[#71717a]">Canvas</div>
      <div className="text-[11px] text-neutral-600">{subtitle}</div>
    </div>
  </div>
);

type AppCanvasProps = {
  className?: string;
};

export const AppCanvas = ({ className }: AppCanvasProps) => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  // Auto-start dev server when workspace is selected
  useAutoStartDevServer(activeWorkspaceId);

  // Subscribe to component file changes and invalidate the list query
  useUserComponentsWatcher(activeWorkspaceId);

  const { data: devServer, isPending: isDevServerPending } =
    useDevServerStatus(activeWorkspaceId);
  const {
    data: userComponents,
    isPending: isComponentsPending,
    isError,
  } = useUserComponents(activeWorkspaceId);
  const { data: frameLayouts, isPending: isLayoutsPending } =
    useFrameLayouts(activeWorkspaceId);

  if (!activeWorkspaceId) {
    return <CanvasPlaceholder subtitle="No workspace selected" className={className} />;
  }

  if (!devServer?.running) {
    return (
      <CanvasPlaceholder
        subtitle={isDevServerPending ? "Checking dev server..." : "Dev server not running"}
        className={className}
      />
    );
  }

  if (isComponentsPending || isLayoutsPending) {
    return <CanvasPlaceholder subtitle="Loading components..." className={className} />;
  }

  if (isError || !userComponents) {
    return <CanvasPlaceholder subtitle="Error loading components" className={className} />;
  }

  if (userComponents.length === 0) {
    return (
      <div className={cn("flex-1 flex items-center justify-center bg-neutral-800 relative", className)}>
        <GridPattern />
        <EmptyState className="z-10" />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <WorkspaceCanvas
        workspaceId={activeWorkspaceId}
        userComponents={userComponents}
        port={devServer.port}
        savedLayouts={frameLayouts}
        className={className}
      />
    </ReactFlowProvider>
  );
};
