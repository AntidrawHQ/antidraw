import {
  ReactFlow,
  useNodesState,
  type Node,
  type NodeTypes,
  type NodeProps,
  NodeResizer,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import { useUserComponents } from "./store/userComponents";

const IframeComponent = ({ url }: { url: string }) => {
  return (
    <iframe
      src={url}
      className="w-full h-full border-0"
      sandbox="allow-scripts allow-same-origin"
    />
  );
};

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
        const ComponentNode = ({ selected }: NodeProps) => (
          <div className="overflow-hidden h-full w-full">
            <NodeResizer isVisible={selected} />
            <IframeComponent
              url={`http://localhost:5174/preview?componentName=${component.name}`}
            />
          </div>
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

  const [nodes, , onNodesChange] = useNodesState(initialNodes);

  console.log(nodeTypes);
  console.log(initialNodes);

  return (
    <div style={{ height: "100vh", width: "100%" }}>
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView
        maxZoom={2}
        nodesDraggable={true}
        nodesConnectable={false}
        elementsSelectable={true}
        selectNodesOnDrag={false}
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
