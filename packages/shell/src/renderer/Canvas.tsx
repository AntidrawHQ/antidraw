import { ReactFlowProvider } from "@xyflow/react";
import { useCallback, useEffect } from "react";
import { useUserComponents, useUserComponentsWatcher } from "./store/userComponents";
import { useWorkspaceStore } from "./store/workspace";
import { useDevServerStatus, useAutoStartDevServer } from "./lib/workspace-ops";
import { useFrameLayouts } from "./lib/frame-layout-ops";
import { saveFrameLayouts, type FrameLayoutData } from "./lib/api";
import { cn } from "./lib/utils";
import { Canvas, useFocusComponent, type FrameLayer, type FrameLayout } from "./canvas/Canvas";
import { CanvasToolbar } from "./components/CanvasToolbar";
import { EmptyState } from "./components/EmptyState";
import { renderFrameInspector } from "./inspector/FrameInspector";
import { InspectorControls } from "./inspector/InspectorControls";
import { CommentFlow, renderFrameComments } from "./comments/CommentFlow";
import { CommentControls } from "./comments/CommentControls";
import { useCanvasTool } from "./comments/store";
import { RightPanel, ShowPanel } from "./design/RightPanel";
import { EditBar } from "./design/EditBar";
import { DesignSync } from "./design/use-design";
import { useCanvasThumbnail } from "./lib/thumbnail";
import { track } from "@/renderer/lib/analytics";

// Over each frame: the tools (the inspector's and the Comment tool's).
const renderFrameLayers: FrameLayer = (frame) => (
  <>
    {renderFrameInspector(frame)}
    {renderFrameComments(frame)}
  </>
);

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

const trackRefresh = () => track("frame_refreshed");

const openFullscreen = (url: string) => {
  track("frame_opened_in_window");
  window.electronAPI.openPreviewWindow(url, useWorkspaceStore.getState().activeWorkspaceId ?? undefined);
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
  const seeCode = useCallback(
    (componentName: string) => {
      track("frame_code_viewed");
      setCodePanelComponentName(componentName);
    },
    [setCodePanelComponentName],
  );
  // Inspect and Comment pick in the frames themselves.
  const picking = useCanvasTool() !== "pointer";
  const onFrameActivity = useCanvasThumbnail(workspaceId);

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
      onFrameActivity={onFrameActivity}
      onFullscreen={openFullscreen}
      onSeeCode={seeCode}
      onRefresh={trackRefresh}
      frameLayer={renderFrameLayers}
      framesTakePointer={picking}
      className={className}
    >
      <FocusRequestedComponent />
      <InspectorControls />
      <CommentControls />
      <CommentFlow />
      <DesignSync />
      <EditBar />
      <ShowPanel />
      <CanvasToolbar />
    </Canvas>
  );
};

type CanvasPlaceholderProps = {
  subtitle: string;
  className?: string;
};

const CanvasPlaceholder = ({ subtitle, className }: CanvasPlaceholderProps) => (
  <div className={cn("flex-1 flex items-center justify-center bg-[#282828] relative", className)}>
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
      <div className={cn("flex-1 flex items-center justify-center bg-[#282828] relative", className)}>
        <EmptyState className="z-10" />
      </div>
    );
  }

  // The right panel (Design, Comments) beside the frames.
  return (
    <ReactFlowProvider>
      <div className={cn("flex min-w-0", className)}>
        <WorkspaceCanvas
          workspaceId={activeWorkspaceId}
          userComponents={userComponents}
          port={devServer.port}
          savedLayouts={frameLayouts}
          className="min-w-0 flex-1"
        />
        <RightPanel />
      </div>
    </ReactFlowProvider>
  );
};
