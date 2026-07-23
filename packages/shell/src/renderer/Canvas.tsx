import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useStore,
  NodeToolbar,
  Position,
  type Node,
  type NodeTypes,
  type NodeProps,
  type NodeChange,
  NodeResizer,
  SelectionMode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useUserComponents, useUserComponentsWatcher } from "./store/userComponents";
import { useWorkspaceStore } from "./store/workspace";
import { useDevServerStatus, useAutoStartDevServer } from "./lib/workspace-ops";
import { useFrameLayouts } from "./lib/frame-layout-ops";
import { saveFrameLayouts, type FrameLayoutData } from "./lib/api";
import { cn } from "./lib/utils";
import { Semaphore } from "./lib/semaphore";
import { PillToggleToolbar } from "./components/PillToggleToolbar";
import { EmptyState } from "./components/EmptyState";
import { useMountEffect } from "./hooks/use-mount-effect";

type IframeNodeProps = {
  url: string | undefined;
  selected: boolean;
  onLoad?: () => void;
};

const IframeNode = memo(({ url, selected, onLoad }: IframeNodeProps) => {
  const [isResizing, setIsResizing] = useState(false);
  const [interactionMode, setInteractionMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Exit interaction mode when node is deselected
  useEffect(() => {
    if (!selected) {
      setInteractionMode(false);
    }
  }, [selected]);

  const handleDoubleClick = useCallback(() => {
    setInteractionMode(true);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setInteractionMode(false);
    }
  }, []);

  // Use a class-based approach for resizing to avoid re-renders
  const handleResizeStart = useCallback(() => {
    setIsResizing(true);
    iframeRef.current?.classList.add("resizing");
  }, []);

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false);
    iframeRef.current?.classList.remove("resizing");
  }, []);

  return (
    <div
      className="iframe-node-container h-full w-full"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <NodeResizer
        isVisible={selected}
        handleClassName="!w-3 !h-3"
        onResizeStart={handleResizeStart}
        onResizeEnd={handleResizeEnd}
      />

      {/* Iframe wrapper with overflow-hidden to clip iframe content */}
      <div className="absolute inset-0 overflow-hidden">
        {url ? (
          <iframe
            ref={iframeRef}
            src={url}
            className="iframe-content h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin"
            onLoad={onLoad}
          />
        ) : (
          <div className="flex items-center justify-center h-full bg-neutral-900">
            <span className="text-xs text-neutral-500">Loading...</span>
          </div>
        )}
      </div>

      {/* Overlay on top of iframe - blocks events when not in interaction mode */}
      {!interactionMode && (
        <div
          className="absolute inset-0 z-10 cursor-grab"
          onDoubleClick={handleDoubleClick}
        />
      )}
    </div>
  );
});

// Node data type for iframe nodes
type IframeNodeData = {
  url: string;
  componentName: string;
};

// Define node type alias for better type inference
type IframeReactFlowNode = Node<IframeNodeData, "iframe">;

// Semaphore to limit concurrent iframe loads
const iframeSemaphore = new Semaphore(10);

// Wrapper component that React Flow renders - defined OUTSIDE component to prevent recreation
const IframeNodeRenderer = ({
  id,
  data,
  selected,
}: NodeProps<IframeReactFlowNode>) => {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const releaseRef = useRef<(() => void) | null>(null);
  const multiSelected = useStore((s) => s.nodes.filter((n) => n.selected).length > 1);

  useEffect(() => {
    let cancelled = false;

    iframeSemaphore.acquire().then((release) => {
      if (cancelled) {
        release();
        return;
      }
      releaseRef.current = release;
      setUrl(data.url);
    });

    return () => {
      cancelled = true;
      releaseRef.current?.();
      releaseRef.current = null;
    };
  }, [data.url]);

  const handleLoad = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = null;
  }, []);

  const handleRefresh = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  const handleFullscreen = useCallback(() => {
    const fullscreenUrl = new URL(data.url);
    fullscreenUrl.searchParams.set("fullscreen", "true");
    window.electronAPI.openPreviewWindow(fullscreenUrl.toString());
  }, [data.url]);

  const iframeUrl = useMemo(() => {
    if (!url) return undefined;
    if (refreshCounter === 0) return url;
    const parsed = new URL(url);
    parsed.searchParams.set("_r", String(refreshCounter));
    return parsed.toString();
  }, [url, refreshCounter]);

  return (
    <>
      <NodeToolbar position={Position.Top} align="start" isVisible={true} offset={8}>
        <PillToggleToolbar
          componentName={data.componentName}
          nodeId={id}
          selected={selected && !multiSelected}
          onRefresh={handleRefresh}
          onFullscreen={handleFullscreen}
        />
      </NodeToolbar>
      <IframeNode url={iframeUrl} selected={selected} onLoad={handleLoad} />
    </>
  );
};

// Define nodeTypes at module level - this is critical for React Flow performance
const nodeTypes: NodeTypes = {
  iframe: IframeNodeRenderer,
};

type UserComponent = {
  name: string;
};

// Grid pattern background component
const gridPatternStyle = {
  backgroundImage: "radial-gradient(#2d2d2d 1px, transparent 1px)",
  backgroundSize: "20px 20px",
} as const;

const GridPattern = () => (
  <div
    className="absolute inset-0 opacity-50 pointer-events-none"
    style={gridPatternStyle}
  />
);

// Zero-area nodes match every selection box (xyflow's containment check is
// overlappingArea >= width * height, trivially true when the area is 0), so
// dimensions must never collapse to 0. Matches NodeResizer's default minimum.
const MIN_NODE_SIZE = 10;

const clampNodeSize = (size: number) => Math.max(size, MIN_NODE_SIZE);

const CanvasContent = ({
  workspaceId,
  userComponents,
  port,
  savedLayouts,
  className,
}: {
  workspaceId: string;
  userComponents: UserComponent[];
  port: number;
  savedLayouts: FrameLayoutData[] | undefined;
  className?: string;
}) => {
  // Create initial nodes once on mount, merging saved layouts with defaults
  const initialNodes = useMemo<IframeReactFlowNode[]>(() => {
    const layoutMap = new Map(
      (savedLayouts ?? []).map((l) => [l.componentName, l]),
    );

    const withLayout: IframeReactFlowNode[] = [];
    const withoutLayout: UserComponent[] = [];

    for (const component of userComponents) {
      const saved = layoutMap.get(component.name);
      if (saved) {
        withLayout.push({
          id: `${component.name}-1`,
          type: "iframe" as const,
          position: { x: saved.x, y: saved.y },
          style: {
            width: clampNodeSize(saved.width),
            height: clampNodeSize(saved.height),
          },
          data: {
            url: `https://localhost:${port}/preview?componentName=${component.name}`,
            componentName: component.name,
          },
        });
      } else {
        withoutLayout.push(component);
      }
    }

    // New components: append to the right of the rightmost existing node,
    // matching its y so they continue the same row.
    const rightmost = withLayout.reduce<IframeReactFlowNode | null>(
      (acc, n) => (!acc || n.position.x > acc.position.x ? n : acc),
      null,
    );
    const baseX = rightmost ? rightmost.position.x : -400;
    const baseY = rightmost ? rightmost.position.y : 100;

    const newNodes = withoutLayout.map((component, index) => ({
      id: `${component.name}-1`,
      type: "iframe" as const,
      position: { x: baseX + 500 + index * 600, y: baseY },
      style: { width: 400, height: 300 },
      data: {
        url: `https://localhost:${port}/preview?componentName=${component.name}`,
        componentName: component.name,
      },
    }));

    return [...withLayout, ...newNodes];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  // Ref to always hold latest nodes for debounced save
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const layouts = nodesRef.current.map((n) => ({
        componentName: n.data.componentName,
        x: n.position.x,
        y: n.position.y,
        width: typeof n.style?.width === "number" ? n.style.width : 400,
        height: typeof n.style?.height === "number" ? n.style.height : 300,
      }));
      saveFrameLayouts(workspaceId, layouts); // fire-and-forget
    }, 500);
  }, [workspaceId]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => clearTimeout(saveTimeoutRef.current);
  }, []);

  const handleNodesChange = useCallback(
    (changes: NodeChange<IframeReactFlowNode>[]) => {
      onNodesChange(changes);

      const hasLayoutChange = changes.some(
        (c) => c.type === "position" || c.type === "dimensions",
      );
      if (hasLayoutChange) {
        scheduleSave();
      }
    },
    [onNodesChange, scheduleSave],
  );

  const handleNodesChangeRef = useRef(handleNodesChange);
  handleNodesChangeRef.current = handleNodesChange;

  useMountEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "component-size") return;
      const { componentName, width, height } = event.data;
      const node = nodesRef.current.find(
        (n) => n.data.componentName === componentName,
      );
      if (!node) return;
      handleNodesChangeRef.current([
        {
          id: node.id,
          type: "dimensions",
          dimensions: {
            width: clampNodeSize(width),
            height: clampNodeSize(height),
          },
          setAttributes: true,
        },
      ]);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  // Sync new components into nodes when userComponents changes
  useEffect(() => {
    setNodes((currentNodes) => {
      const existingComponentNames = new Set(
        currentNodes.map((n) => n.data.componentName)
      );
      const newComponents = userComponents.filter(
        (c) => !existingComponentNames.has(c.name)
      );

      if (newComponents.length === 0) return currentNodes;

      const maxX = Math.max(...currentNodes.map((n) => n.position.x), 0);
      return [
        ...currentNodes,
        ...newComponents.map((component, index) => ({
          id: `${component.name}-1`,
          type: "iframe" as const,
          position: { x: maxX + 500 + index * 600, y: 100 },
          style: { width: 400, height: 300 },
          data: {
            url: `https://localhost:${port}/preview?componentName=${component.name}`,
            componentName: component.name,
          },
        })),
      ];
    });
  }, [userComponents, port, setNodes]);

  // Focus on component when clicked in ComponentPanel
  const reactFlow = useReactFlow();
  const focusComponentName = useWorkspaceStore((s) => s.focusComponentName);
  const setFocusComponentName = useWorkspaceStore((s) => s.setFocusComponentName);

  useEffect(() => {
    if (focusComponentName) {
      const nodeId = `${focusComponentName}-1`;
      reactFlow.fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.3 });
      setFocusComponentName(null);
    }
  }, [focusComponentName, reactFlow, setFocusComponentName]);

  return (
    <div className={cn("h-full w-full bg-neutral-800 relative", className)}>
      <GridPattern />
      <ReactFlow
        nodes={nodes}
        onNodesChange={handleNodesChange}
        nodeTypes={nodeTypes}
        fitView
        maxZoom={4}
        minZoom={0.1}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        selectNodesOnDrag={true}
        selectionOnDrag={true}
        selectionMode={SelectionMode.Partial}
        panOnScroll={true}
        panOnDrag={[1, 2]}
        panActivationKeyCode="Space"
        onlyRenderVisibleElements={false}
        proOptions={{ hideAttribution: true }}
      >
        {/* Children: Background, Controls, MiniMap, Panels */}
      </ReactFlow>
    </div>
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
      <CanvasContent
        workspaceId={activeWorkspaceId}
        userComponents={userComponents}
        port={devServer.port}
        savedLayouts={frameLayouts}
        className={className}
      />
    </ReactFlowProvider>
  );
};
