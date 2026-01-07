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
import { useDevServerStatus } from "./lib/workspace-ops";

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

const CanvasContent = ({
  userComponents,
  port,
}: {
  userComponents: UserComponent[];
  port: number;
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
    <div style={{ height: "100vh", width: "100%" }}>
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

export const AppCanvas = () => {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);

  const { data: devServer, isPending: isDevServerPending } =
    useDevServerStatus(activeWorkspaceId);
  const {
    data: userComponents,
    isPending: isComponentsPending,
    isError,
  } = useUserComponents(activeWorkspaceId);

  if (!activeWorkspaceId) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400">
        No workspace selected
      </div>
    );
  }

  if (!devServer) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400">
        {isDevServerPending
          ? "Checking dev server..."
          : "Dev server not running"}
      </div>
    );
  }

  if (isComponentsPending) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400">
        Loading components...
      </div>
    );
  }

  if (isError || !userComponents) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-400">
        Error loading components
      </div>
    );
  }

  return (
    <CanvasContent userComponents={userComponents} port={devServer.port} />
  );
};
