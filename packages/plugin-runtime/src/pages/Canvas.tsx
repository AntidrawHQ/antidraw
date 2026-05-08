/// <reference path="../user-components.d.ts" />
import { useMemo } from "react"
import {
  ReactFlow,
  useNodesState,
  NodeResizer,
  type Node,
  type NodeTypes,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { userComponents } from "@antidrawapp/user-components"

type ComponentMap = Record<string, React.ComponentType>

const createNodeTypes = (components: ComponentMap): NodeTypes => {
  const nodeTypes: NodeTypes = {}

  for (const [name, Component] of Object.entries(components)) {
    nodeTypes[name] = ({ selected }: NodeProps) => (
      <div className="overflow-hidden h-full w-full">
        <NodeResizer isVisible={selected} />
        <Component />
      </div>
    )
  }

  return nodeTypes
}

const createInitialNodes = (components: ComponentMap): Node[] => {
  return Object.keys(components).map((name, index) => ({
    id: `${name.toLowerCase()}-${index}`,
    type: name,
    position: { x: 100 + index * 300, y: 100 },
    data: {},
  }))
}

export const Canvas = () => {
  const nodeTypes = useMemo(
    () => createNodeTypes(userComponents as ComponentMap),
    []
  )

  const initialNodes = useMemo(
    () => createInitialNodes(userComponents as ComponentMap),
    []
  )

  const [nodes, , onNodesChange] = useNodesState(initialNodes)

  return (
    <div className="h-screen w-full bg-neutral-900">
      <ReactFlow
        nodes={nodes}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        selectNodesOnDrag={false}
        panOnScroll
        panOnDrag={[1, 2]}
        onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      />
    </div>
  )
}

export default Canvas
