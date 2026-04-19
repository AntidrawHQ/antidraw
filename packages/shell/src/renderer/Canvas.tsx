import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  NodeToolbar,
  Position,
  type Node,
  type NodeTypes,
  type NodeProps,
  NodeResizer,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useUserComponents } from "./store/userComponents";
import { useWorkspaceStore } from "./store/workspace";
import { useDevServerStatus, useAutoStartDevServer } from "./lib/workspace-ops";
import { cn } from "./lib/utils";
import { Semaphore } from "./lib/semaphore";
import { PillToggleToolbar } from "./components/PillToggleToolbar";
import { EmptyState } from "./components/EmptyState";

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
        <PillToggleToolbar componentName={data.componentName} nodeId={id} selected={selected} onRefresh={handleRefresh} />
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

const CanvasContent = ({
  userComponents,
  port,
  className,
}: {
  userComponents: UserComponent[];
  port: number;
  className?: string;
}) => {
  // Create initial nodes once on mount (useNodesState uses useState internally, no lazy init support)
  const initialNodes = useMemo<IframeReactFlowNode[]>(
    () =>
      userComponents.map((component, index) => ({
        id: `${component.name}-1`,
        type: "iframe" as const,
        position: { x: 100 + index * 600, y: 100 },
        style: { width: 400, height: 300 },
        data: {
          url: `https://localhost:${port}/preview?componentName=${component.name}`,
          componentName: component.name,
        },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "component-size") {
        const { componentName, width, height } = event.data;
        setNodes((nds) =>
          nds.map((node) =>
            node.data.componentName === componentName
              ? { ...node, style: { ...node.style, width, height } }
              : node
          )
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [setNodes]);

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
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView
        maxZoom={4}
        minZoom={0.1}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        selectNodesOnDrag={true}
        panOnScroll={true}
        panOnDrag={[1, 2]}
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

  const { data: devServer, isPending: isDevServerPending } =
    useDevServerStatus(activeWorkspaceId);
  const {
    data: userComponents,
    isPending: isComponentsPending,
    isError,
  } = useUserComponents(activeWorkspaceId);

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

  if (isComponentsPending) {
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
        userComponents={userComponents}
        port={devServer.port}
        className={className}
      />
    </ReactFlowProvider>
  );
};
