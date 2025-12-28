import {
  ReactFlow,
  useNodesState,
  type Node,
  type NodeTypes,
  type NodeProps,
  NodeResizer,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const SampleComponent: React.FC<React.HTMLAttributes<HTMLDivElement>> = (
  props
) => (
  <div {...props} className=" bg-neutral-800">
    <h1 className="text-4xl text-neutral-200">hey there, this is a node</h1>
  </div>
);

const SampleComponent2: React.FC<React.HTMLAttributes<HTMLDivElement>> = (
  props
) => (
  <div {...props} className=" bg-neutral-800">
    <h1 className="text-4xl text-neutral-200">another node here!</h1>
  </div>
);

const componentNodeTypes = Object.entries(userComponents).map(
  ([name, Component]) => {
    const ComponentNode = ({ selected }: NodeProps) => {
      return (
        <div className="overflow-hidden h-full w-full">
          <NodeResizer isVisible={selected} />
          <Component />
        </div>
      );
    };

    return { name, ComponentNode };
  }
);

const componentNodes = componentNodeTypes.map(({ name, ComponentNode }) => {
  return {
    id: `${name.toLowerCase()}-1`,
    type: name,
    position: { x: Math.random() * 800, y: Math.random() * 400 },
    data: {},
  };
});

const App = () => {
  const sampleComponentNode = ({
    data,
    selected,
    height,
    width,
  }: NodeProps) => {
    console.group("Rendering SampleComponent Node");
    console.log({ data, selected, height, width });
    console.groupEnd();

    return (
      <div className="overflow-hidden h-full w-full">
        <NodeResizer isVisible={selected} />
        <SampleComponent />
      </div>
    );
  };

  const sampleComponent2Node = ({
    data,
    selected,
    height,
    width,
  }: NodeProps) => {
    console.group("Rendering SampleComponent2 Node");
    console.log({ data, selected, height, width });
    console.groupEnd();

    return (
      <div className="overflow-hidden h-full w-full">
        <NodeResizer isVisible={selected} />
        <SampleComponent2 />
      </div>
    );
  };

  const nodeTypes: NodeTypes = {
    sampleComponent: sampleComponentNode,
    sampleComponent2: sampleComponent2Node,
  };

  const initialNodes: Node[] = [
    {
      id: "sample-component-1", // Unique ID
      type: "sampleComponent", // Must match key in nodeTypes
      position: { x: 100, y: 100 }, // Canvas position
      // style: { width: 500, height: 300 }, // Initial size
      data: {},
    },
    {
      id: "sample-component-2", // Unique ID
      type: "sampleComponent2", // Must match key in nodeTypes
      position: { x: 700, y: 100 }, // Canvas position
      // style: { width: 400, height: 200 }, // Initial size

      data: {},
    },
  ];

  const [nodes, , onNodesChange] = useNodesState(initialNodes);

  return (
    <div className="h-screen w-full bg-neutral-800">
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView // Auto-fit canvas to nodes on mount
        // minZoom={0.1} // 10% minimum zoom
        maxZoom={2} // 200% maximum zoom
        nodesDraggable={true} // Enable node dragging
        nodesConnectable={false} // Disable edge creation (preview-only)
        elementsSelectable={true} // Allow click-to-select
        selectNodesOnDrag={false} // Don't select when dragging
        panOnScroll={true} // Scroll wheel pans canvas
        panOnDrag={[1, 2]} // Middle (1) + right (2) mouse buttons pan
        onlyRenderVisibleElements={true} // Virtualization for performance
        proOptions={{ hideAttribution: true }}
      >
        {/* Children: Background, Controls, MiniMap, Panels */}
      </ReactFlow>
    </div>
  );
};

export default App;
