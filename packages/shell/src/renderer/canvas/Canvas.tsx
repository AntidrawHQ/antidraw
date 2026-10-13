import {
  ReactFlow,
  useNodesState,
  useReactFlow,
  useStore,
  useStoreApi,
  NodeToolbar,
  Position,
  type Node,
  type NodeTypes,
  type NodeProps,
  type NodeChange,
  NodeResizer,
  SelectionMode,
  MiniMap,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas.css";
import {
  createContext,
  memo,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { cn } from "@/renderer/lib/utils";
import { useMountEffect } from "@/renderer/hooks/use-mount-effect";
import { Semaphore } from "./semaphore";
import { PillToggleToolbar } from "./PillToggleToolbar";

// The canvas is shared by the shell and the published viewer, so nothing in
// this folder reaches for the shell's API, stores or Electron: whatever differs
// between the two comes in through props.

export type FrameLayout = {
  componentName: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

// The React Flow node that holds a component's frame.
const frameNodeId = (componentName: string) => `${componentName}-1`;

// Pans and zooms the canvas to one component's frame. For the host's own
// controls (a component list, a "View" button): call it inside the same
// ReactFlowProvider as the canvas.
export const useFocusComponent = () => {
  const reactFlow = useReactFlow();
  return useCallback(
    (componentName: string) => {
      reactFlow.fitView({
        nodes: [{ id: frameNodeId(componentName) }],
        duration: 300,
        padding: 0.3,
      });
    },
    [reactFlow],
  );
};

// Touch screens (a phone opening a published canvas) have no wheel or middle
// button to pan with, so a drag on the background pans instead of drawing a
// selection box.
const coarsePointer = window.matchMedia("(pointer: coarse)");
const useCoarsePointer = () =>
  useSyncExternalStore(
    (onChange) => {
      coarsePointer.addEventListener("change", onChange);
      return () => coarsePointer.removeEventListener("change", onChange);
    },
    () => coarsePointer.matches,
  );

// Per-frame actions reach the node renderers through context rather than node
// data, so nodeTypes can stay module-level (see below).
type FrameActions = {
  onFullscreen: (url: string) => void;
  onSeeCode?: (componentName: string) => void;
  frameLayer?: FrameLayer;
};

// Drawn over a frame's preview, for a host's own tools (the shell's
// inspector). It gets the iframe once there is one.
export type FrameLayer = (frame: {
  componentName: string;
  iframe: HTMLIFrameElement | null;
}) => ReactNode;

const FrameActionsContext = createContext<FrameActions>({
  onFullscreen: () => {},
});

type IframeNodeProps = {
  componentName: string;
  url: string | undefined;
  selected: boolean;
  onLoad?: () => void;
};

const IframeNode = memo(({ componentName, url, selected, onLoad }: IframeNodeProps) => {
  const [isResizing, setIsResizing] = useState(false);
  const [interactionMode, setInteractionMode] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const { frameLayer } = useContext(FrameActionsContext);
  const setIframeRef = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
    setIframe(el);
  }, []);

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
            ref={setIframeRef}
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

      {frameLayer?.({ componentName, iframe })}
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
  const { onFullscreen, onSeeCode } = useContext(FrameActionsContext);

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
    onFullscreen(fullscreenUrl.toString());
  }, [data.url, onFullscreen]);

  const handleSeeCode = useMemo(
    () => (onSeeCode ? () => onSeeCode(data.componentName) : undefined),
    [onSeeCode, data.componentName],
  );

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
          onSeeCode={handleSeeCode}
        />
      </NodeToolbar>
      <IframeNode
        componentName={data.componentName}
        url={iframeUrl}
        selected={selected}
        onLoad={handleLoad}
      />
    </>
  );
};

// Define nodeTypes at module level - this is critical for React Flow performance
const nodeTypes: NodeTypes = {
  iframe: IframeNodeRenderer,
};

// The minimap's frames: brighter when selected, like their selection outline.
const miniMapNodeColor = (node: Node) => (node.selected ? "#a3a3a3" : "#525252");

const miniMapStyle = {
  width: 180,
  height: 120,
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "0 4px 16px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06)",
};

type CanvasComponent = {
  name: string;
};

// Zero-area nodes match every selection box (xyflow's containment check is
// overlappingArea >= width * height, trivially true when the area is 0), so
// dimensions must never collapse to 0. Matches NodeResizer's default minimum.
const MIN_NODE_SIZE = 10;

const clampNodeSize = (size: number) => Math.max(size, MIN_NODE_SIZE);

// A frame's size until its component reports its own.
const NEW_FRAME_SIZE = { width: 400, height: 300 };

// The space between frames the canvas places itself.
const FRAME_GAP = 100;

// A resize (by hand, or a component-size message) sets width and height;
// style keeps the size the frame was created with.
const frameWidth = (n: IframeReactFlowNode) =>
  n.width ?? (typeof n.style?.width === "number" ? n.style.width : NEW_FRAME_SIZE.width);
const frameHeight = (n: IframeReactFlowNode) =>
  n.height ?? (typeof n.style?.height === "number" ? n.style.height : NEW_FRAME_SIZE.height);

const newFrame = (
  component: CanvasComponent,
  frameUrl: (componentName: string) => string,
): IframeReactFlowNode => ({
  id: frameNodeId(component.name),
  type: "iframe" as const,
  // Set by lineUp.
  position: { x: 0, y: 0 },
  style: { ...NEW_FRAME_SIZE },
  data: {
    url: frameUrl(component.name),
    componentName: component.name,
  },
});

// Puts the frames the canvas placed (settling, in the order placed) in a row
// after the rest, a gap apart and level with the rightmost of the rest.
const lineUp = (nodes: IframeReactFlowNode[], settling: string[]) => {
  if (settling.length === 0) return nodes;
  const rightEdge = (n: IframeReactFlowNode) => n.position.x + frameWidth(n);
  const rightmost = nodes
    .filter((n) => !settling.includes(n.id))
    .reduce<IframeReactFlowNode | null>(
      (acc, n) => (!acc || rightEdge(n) > rightEdge(acc) ? n : acc),
      null,
    );
  let x = rightmost ? rightEdge(rightmost) + FRAME_GAP : 100;
  const y = rightmost ? rightmost.position.y : 100;

  const positions = new Map<string, { x: number; y: number }>();
  for (const id of settling) {
    const node = nodes.find((n) => n.id === id);
    if (!node) continue;
    positions.set(id, { x, y });
    x += frameWidth(node) + FRAME_GAP;
  }
  return nodes.map((n) => {
    const position = positions.get(n.id);
    return position && (position.x !== n.position.x || position.y !== n.position.y)
      ? { ...n, position }
      : n;
  });
};

type CanvasProps = {
  components: CanvasComponent[];
  // Where each frame was last placed; components without one are appended.
  savedLayouts: FrameLayout[] | undefined;
  // The URL a frame loads to preview the component.
  frameUrl: (componentName: string) => string;
  // Called (debounced) after frames are moved or resized. Without it, changes
  // last only as long as the page.
  onLayoutsChange?: (layouts: FrameLayout[]) => void;
  onFullscreen: (url: string) => void;
  // Without it, frames have no See Code button.
  onSeeCode?: (componentName: string) => void;
  frameLayer?: FrameLayer;
  className?: string;
  // Rendered inside React Flow, for hosts that drive the viewport (useReactFlow).
  children?: ReactNode;
};

// Must be rendered inside a ReactFlowProvider.
export const Canvas = ({
  components,
  savedLayouts,
  frameUrl,
  onLayoutsChange,
  onFullscreen,
  onSeeCode,
  frameLayer,
  className,
  children,
}: CanvasProps) => {
  // Create initial nodes once on mount, merging saved layouts with defaults
  const initial = useMemo(() => {
    const layoutMap = new Map(
      (savedLayouts ?? []).map((l) => [l.componentName, l]),
    );

    const withLayout: IframeReactFlowNode[] = [];
    const withoutLayout: CanvasComponent[] = [];

    for (const component of components) {
      const saved = layoutMap.get(component.name);
      if (saved) {
        withLayout.push({
          id: frameNodeId(component.name),
          type: "iframe" as const,
          position: { x: saved.x, y: saved.y },
          style: {
            width: clampNodeSize(saved.width),
            height: clampNodeSize(saved.height),
          },
          data: {
            url: frameUrl(component.name),
            componentName: component.name,
          },
        });
      } else {
        withoutLayout.push(component);
      }
    }

    // New components continue the row of the rightmost saved frame.
    const settling = withoutLayout.map((component) => frameNodeId(component.name));
    return {
      nodes: lineUp(
        [...withLayout, ...withoutLayout.map((c) => newFrame(c, frameUrl))],
        settling,
      ),
      settling,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);

  // The frames the canvas placed, in order, until the user picks a frame.
  // Each grows to its component once loaded, so they're lined up again then
  // to keep them from covering each other.
  const settlingRef = useRef(initial.settling);

  // Ref to always hold latest nodes for debounced save
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onLayoutsChangeRef = useRef(onLayoutsChange);
  onLayoutsChangeRef.current = onLayoutsChange;

  const scheduleSave = useCallback(() => {
    // The callback as of the change, not as of the save: a host that swaps it
    // (the shell, for another workspace) must not get the old one's layout.
    const onLayoutsChange = onLayoutsChangeRef.current;
    if (!onLayoutsChange) return;
    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      const layouts = nodesRef.current.map((n) => ({
        componentName: n.data.componentName,
        x: n.position.x,
        y: n.position.y,
        width: frameWidth(n),
        height: frameHeight(n),
      }));
      onLayoutsChange(layouts);
    }, 500);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => clearTimeout(saveTimeoutRef.current);
  }, []);

  const handleNodesChange = useCallback(
    (changes: NodeChange<IframeReactFlowNode>[]) => {
      onNodesChange(changes);

      // Once the user picks a frame (to move it, resize it or use it), it stays
      // put, and so do the rest from then on.
      if (changes.some((c) => c.type === "position" || (c.type === "select" && c.selected))) {
        settlingRef.current = [];
      }

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
      // Only the frames' own origin may size them: on the web the canvas sits
      // on a page any other window can post to.
      if (!node || event.origin !== new URL(node.data.url).origin) return;
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
      if (settlingRef.current.length > 0) {
        setNodes((nodes) => lineUp(nodes, settlingRef.current));
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  // Sync new components into nodes when the component list changes
  useEffect(() => {
    setNodes((currentNodes) => {
      const existingComponentNames = new Set(
        currentNodes.map((n) => n.data.componentName)
      );
      const newComponents = components.filter(
        (c) => !existingComponentNames.has(c.name)
      );

      if (newComponents.length === 0) return currentNodes;

      // A Set, as StrictMode runs this updater twice.
      settlingRef.current = [
        ...new Set([
          ...settlingRef.current,
          ...newComponents.map((component) => frameNodeId(component.name)),
        ]),
      ];
      return lineUp(
        [...currentNodes, ...newComponents.map((c) => newFrame(c, frameUrl))],
        settlingRef.current,
      );
    });
  }, [components, frameUrl, setNodes]);

  // After a box selection xyflow keeps a selection rect on top of the selected
  // nodes, and it swallows the double click that enters interaction mode. Around
  // a single node it looks just like a normal selection, so drop it.
  const store = useStoreApi();
  const soloBoxSelection = useStore(
    (s) => s.nodesSelectionActive && s.nodes.filter((n) => n.selected).length === 1,
  );

  useEffect(() => {
    if (soloBoxSelection) {
      store.setState({ nodesSelectionActive: false });
    }
  }, [soloBoxSelection, store]);

  const touch = useCoarsePointer();

  const reactFlow = useReactFlow();
  const focusMiniMapNode = useCallback(
    (_: React.MouseEvent, node: IframeReactFlowNode) => {
      reactFlow.fitView({ nodes: [{ id: node.id }], duration: 300, padding: 0.3 });
    },
    [reactFlow],
  );

  const frameActions = useMemo(
    () => ({ onFullscreen, onSeeCode, frameLayer }),
    [onFullscreen, onSeeCode, frameLayer],
  );

  return (
    <FrameActionsContext.Provider value={frameActions}>
      <div className={cn("h-full w-full bg-[#282828] relative", className)}>
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
          selectionOnDrag={!touch}
          selectionMode={SelectionMode.Partial}
          panOnScroll={true}
          panOnDrag={touch ? true : [1, 2]}
          panActivationKeyCode="Space"
          onlyRenderVisibleElements={false}
          proOptions={{ hideAttribution: true }}
        >
          {/* Phones have no room for it: they pinch and drag instead. */}
          {!touch && (
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              onNodeClick={focusMiniMapNode}
              // The titlebar's colour. No dimming outside the viewport, or the
              // whole map turns near-black: its outline marks it instead.
              bgColor="#2A2A2A"
              nodeColor={miniMapNodeColor}
              nodeBorderRadius={6}
              maskColor="transparent"
              maskStrokeColor="rgba(255, 255, 255, 0.35)"
              maskStrokeWidth={1}
              style={miniMapStyle}
            />
          )}
          {children}
        </ReactFlow>
      </div>
    </FrameActionsContext.Provider>
  );
};
