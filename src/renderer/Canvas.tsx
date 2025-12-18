import {
  ReactFlow,
  useNodesState,
  type Node,
  type NodeTypes,
  type NodeProps,
  NodeResizer,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { memo, useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useUserComponents } from "./store/userComponents";

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

type UserComponent = {
  name: string;
};

const CanvasContent = ({
  userComponents,
}: {
  userComponents: UserComponent[];
}) => {
  const nodeTypes: NodeTypes = useMemo(
    () =>
      userComponents.reduce((acc, component) => {
        const ComponentNode = ({ selected, dragging }: NodeProps) => (
          <IframeNode
            url={`http://localhost:5174/preview?componentName=${component.name}`}
            selected={selected}
            dragging={dragging}
          />
        );
        return { ...acc, [component.name]: ComponentNode };
      }, {} as NodeTypes),
    [userComponents]
  );

  const initialNodes: Node[] = userComponents.map((component, index) => ({
    id: `${component.name.toLowerCase()}-1`,
    type: component.name,
    position: { x: 100 + index * 600, y: 100 },
    style: { width: 400, height: 300 },
    data: {},
  }));

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "component-size") {
        const { componentName, width, height } = event.data;
        setNodes((nds) =>
          nds.map((node) =>
            node.type === componentName
              ? { ...node, style: { ...node.style, width, height } }
              : node
          )
        );
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [setNodes]);

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
        onlyRenderVisibleElements={true}
        proOptions={{ hideAttribution: true }}
      >
        {/* Children: Background, Controls, MiniMap, Panels */}
      </ReactFlow>
    </div>
  );
};

export const AppCanvas = () => {
  const {
    data: userComponents,
    isPending,
    isError,
  } = useUserComponents("default-project");

  if (isPending) {
    return <div>Loading user components...</div>;
  }

  if (isError) {
    return <div>Error loading user components.</div>;
  }

  return <CanvasContent userComponents={userComponents} />;
};
