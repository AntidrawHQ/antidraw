import {
  ReactFlow,
  useNodesState,
  type Node,
  type NodeTypes,
  type NodeProps,
  NodeResizer,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useState, useCallback, useEffect, useRef } from "react";
import { useUserComponents } from "./store/userComponents";
import { useWorkspaceStore } from "./store/workspace";
import { useDevServerStatus, useAutoStartDevServer } from "./lib/workspace-ops";
import { cn } from "./lib/utils";

type IframeNodeProps = {
  url: string;
  selected: boolean;
};

const IframeNode = memo(({ url, selected }: IframeNodeProps) => {
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
        <iframe
          ref={iframeRef}
          src={url}
          loading="lazy"
          className="iframe-content h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin"
        />
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

// Wrapper component that React Flow renders - defined OUTSIDE component to prevent recreation
const IframeNodeRenderer = ({
  data,
  selected,
}: NodeProps<IframeReactFlowNode>) => (
  <IframeNode url={data.url} selected={selected} />
);

// Define nodeTypes at module level - this is critical for React Flow performance
const nodeTypes: NodeTypes = {
  iframe: IframeNodeRenderer,
};

type UserComponent = {
  name: string;
};

// Grid pattern background component
const GridPattern = () => (
  <div
    className="absolute inset-0 opacity-50 pointer-events-none"
    style={{
      backgroundImage: "radial-gradient(#2d2d2d 1px, transparent 1px)",
      backgroundSize: "20px 20px",
    }}
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
  // Create initial nodes with URL stored in data (not baked into component type)
  const initialNodes: IframeReactFlowNode[] = userComponents.map(
    (component, index) => ({
      id: `${component.name.toLowerCase()}-1`,
      type: "iframe" as const,
      position: { x: 100 + index * 600, y: 100 },
      style: { width: 400, height: 300 },
      data: {
        url: `http://localhost:${port}/preview?componentName=${component.name}`,
        componentName: component.name,
      },
    })
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
          id: `${component.name.toLowerCase()}-1`,
          type: "iframe" as const,
          position: { x: maxX + 500 + index * 600, y: 100 },
          style: { width: 400, height: 300 },
          data: {
            url: `http://localhost:${port}/preview?componentName=${component.name}`,
            componentName: component.name,
          },
        })),
      ];
    });
  }, [userComponents, port, setNodes]);

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
    return (
      <div
        className={cn(
          "flex-1 flex items-center justify-center bg-neutral-800 relative",
          className
        )}
      >
        <GridPattern />
        <div className="text-center z-10">
          <div className="text-sm text-[#71717a]">Canvas</div>
          <div className="text-[11px] text-neutral-600">No workspace selected</div>
        </div>
      </div>
    );
  }

  if (!devServer) {
    return (
      <div
        className={cn(
          "flex-1 flex items-center justify-center bg-neutral-800 relative",
          className
        )}
      >
        <GridPattern />
        <div className="text-center z-10">
          <div className="text-sm text-[#71717a]">Canvas</div>
          <div className="text-[11px] text-neutral-600">
            {isDevServerPending ? "Checking dev server..." : "Dev server not running"}
          </div>
        </div>
      </div>
    );
  }

  if (isComponentsPending) {
    return (
      <div
        className={cn(
          "flex-1 flex items-center justify-center bg-neutral-800 relative",
          className
        )}
      >
        <GridPattern />
        <div className="text-center z-10">
          <div className="text-sm text-[#71717a]">Canvas</div>
          <div className="text-[11px] text-neutral-600">Loading components...</div>
        </div>
      </div>
    );
  }

  if (isError || !userComponents) {
    return (
      <div
        className={cn(
          "flex-1 flex items-center justify-center bg-neutral-800 relative",
          className
        )}
      >
        <GridPattern />
        <div className="text-center z-10">
          <div className="text-sm text-[#71717a]">Canvas</div>
          <div className="text-[11px] text-neutral-600">Error loading components</div>
        </div>
      </div>
    );
  }

  return (
    <CanvasContent
      userComponents={userComponents}
      port={devServer.port}
      className={className}
    />
  );
};
