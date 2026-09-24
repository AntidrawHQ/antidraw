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

// Touch screens (a phone opening a published canvas) get the mouse's
// gestures, except that a finger has no wheel or middle button to pan with: a
// drag on the background pans, and the selection box that drag draws with a
// mouse starts only after a finger holds still on the background (see
// HoldToBoxSelect).
const coarsePointer = window.matchMedia("(pointer: coarse)");
const useCoarsePointer = () =>
  useSyncExternalStore(
    (onChange) => {
      coarsePointer.addEventListener("change", onChange);
      return () => coarsePointer.removeEventListener("change", onChange);
    },
    () => coarsePointer.matches,
  );

const HOLD_MS = 400;
// A finger that moves further than this before the hold completes is panning.
const HOLD_SLOP_PX = 8;

type ScreenRect = { left: number; top: number; width: number; height: number };

const rectBetween = (a: { x: number; y: number }, b: { x: number; y: number }): ScreenRect => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

// React Flow's selection box colors (.react-flow__selection)
const selectionBoxStyle = {
  background: "rgba(0, 89, 220, 0.08)",
  border: "1px dotted rgba(0, 89, 220, 0.8)",
} as const;

// Hold a finger on the background, then drag: a selection box, selecting
// every frame it touches on release, like a mouse drag on the background.
// React Flow cannot turn a touch it is already panning with into a selection,
// so the box is drawn here, and while it is, touchmove is stopped on the way
// down to React Flow's pan handler. Listens on rootRef, which holds the
// canvas; its own state, so drawing the box re-renders only the box.
const HoldToBoxSelect = ({
  rootRef,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>;
}) => {
  const reactFlow = useReactFlow();
  const store = useStoreApi();
  const [box, setBox] = useState<ScreenRect | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let start: { x: number; y: number; pointerId: number } | null = null;
    let drawing = false;

    const toRoot = (p: { x: number; y: number }) => {
      const bounds = root.getBoundingClientRect();
      return { x: p.x - bounds.left, y: p.y - bounds.top };
    };
    const reset = () => {
      clearTimeout(timer);
      start = null;
      drawing = false;
      setBox(null);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      // A second finger before the hold completes is a pinch, never a
      // selection box. Once the box is drawn it is ignored: React Flow has
      // not seen the first finger move, and would jump to catch up.
      if (!e.isPrimary) {
        if (start && !drawing) reset();
        return;
      }
      if (!(e.target instanceof Element) || !e.target.classList.contains("react-flow__pane")) return;
      start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      timer = setTimeout(() => {
        if (!start) return;
        drawing = true;
        const p = toRoot(start);
        setBox({ left: p.x, top: p.y, width: 0, height: 0 });
      }, HOLD_MS);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.pointerId) return;
      const point = { x: e.clientX, y: e.clientY };
      if (!drawing) {
        if (Math.hypot(point.x - start.x, point.y - start.y) > HOLD_SLOP_PX) reset();
        return;
      }
      setBox(rectBetween(toRoot(start), toRoot(point)));
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.pointerId) return;
      const r = rectBetween(start, { x: e.clientX, y: e.clientY });
      // A box with no area (a hold released in place, a drag along one axis)
      // selects nothing: xyflow counts every node as inside it.
      if (drawing && r.width > 0 && r.height > 0) {
        const topLeft = reactFlow.screenToFlowPosition({ x: r.left, y: r.top });
        const bottomRight = reactFlow.screenToFlowPosition({
          x: r.left + r.width,
          y: r.top + r.height,
        });
        const ids = reactFlow
          .getIntersectingNodes(
            {
              x: topLeft.x,
              y: topLeft.y,
              width: bottomRight.x - topLeft.x,
              height: bottomRight.y - topLeft.y,
            },
            true,
          )
          .map((n) => n.id);
        store.getState().addSelectedNodes(ids);
        // Several frames get the group rectangle a mouse selection leaves.
        store.setState({ nodesSelectionActive: ids.length > 1 });
      }
      reset();
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (start && e.pointerId === start.pointerId) reset();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!drawing) return;
      e.stopPropagation();
      e.preventDefault();
    };

    const capture = { capture: true } as const;
    root.addEventListener("pointerdown", onPointerDown, capture);
    root.addEventListener("pointermove", onPointerMove, capture);
    root.addEventListener("pointerup", onPointerUp, capture);
    root.addEventListener("pointercancel", onPointerCancel, capture);
    root.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    return () => {
      clearTimeout(timer);
      root.removeEventListener("pointerdown", onPointerDown, capture);
      root.removeEventListener("pointermove", onPointerMove, capture);
      root.removeEventListener("pointerup", onPointerUp, capture);
      root.removeEventListener("pointercancel", onPointerCancel, capture);
      root.removeEventListener("touchmove", onTouchMove, capture);
    };
  }, [rootRef, reactFlow, store]);

  if (!box) return null;
  return (
    <div
      className="absolute z-20 pointer-events-none"
      style={{ ...selectionBoxStyle, ...box }}
    />
  );
};

// Per-frame actions reach the node renderers through context rather than node
// data, so nodeTypes can stay module-level (see below).
type FrameActions = {
  onFullscreen: (url: string) => void;
  onSeeCode?: (componentName: string) => void;
};

const FrameActionsContext = createContext<FrameActions>({
  onFullscreen: () => {},
});

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

type CanvasComponent = {
  name: string;
};

// Grid pattern background component
const gridPatternStyle = {
  backgroundImage: "radial-gradient(#2d2d2d 1px, transparent 1px)",
  backgroundSize: "20px 20px",
} as const;

export const GridPattern = () => (
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
  className,
  children,
}: CanvasProps) => {
  // Create initial nodes once on mount, merging saved layouts with defaults
  const initialNodes = useMemo<IframeReactFlowNode[]>(() => {
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

    // New components: append to the right of the rightmost existing node,
    // matching its y so they continue the same row.
    const rightmost = withLayout.reduce<IframeReactFlowNode | null>(
      (acc, n) => (!acc || n.position.x > acc.position.x ? n : acc),
      null,
    );
    const baseX = rightmost ? rightmost.position.x : -400;
    const baseY = rightmost ? rightmost.position.y : 100;

    const newNodes = withoutLayout.map((component, index) => ({
      id: frameNodeId(component.name),
      type: "iframe" as const,
      position: { x: baseX + 500 + index * 600, y: baseY },
      style: { width: 400, height: 300 },
      data: {
        url: frameUrl(component.name),
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
        width: typeof n.style?.width === "number" ? n.style.width : 400,
        height: typeof n.style?.height === "number" ? n.style.height : 300,
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

      const maxX = Math.max(...currentNodes.map((n) => n.position.x), 0);
      return [
        ...currentNodes,
        ...newComponents.map((component, index) => ({
          id: frameNodeId(component.name),
          type: "iframe" as const,
          position: { x: maxX + 500 + index * 600, y: 100 },
          style: { width: 400, height: 300 },
          data: {
            url: frameUrl(component.name),
            componentName: component.name,
          },
        })),
      ];
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
  const rootRef = useRef<HTMLDivElement>(null);

  const frameActions = useMemo(
    () => ({ onFullscreen, onSeeCode }),
    [onFullscreen, onSeeCode],
  );

  return (
    <FrameActionsContext.Provider value={frameActions}>
      <div
        ref={rootRef}
        className={cn(
          "h-full w-full bg-neutral-800 relative",
          // iOS starts a text selection (and its callout menu) under a held
          // finger, which spread over the whole canvas.
          touch && "select-none [-webkit-touch-callout:none]",
          className,
        )}
      >
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
          selectionOnDrag={!touch}
          selectionMode={SelectionMode.Partial}
          panOnScroll={true}
          panOnDrag={touch ? true : [1, 2]}
          panActivationKeyCode="Space"
          onlyRenderVisibleElements={false}
          proOptions={{ hideAttribution: true }}
        >
          {children}
        </ReactFlow>
        {touch && <HoldToBoxSelect rootRef={rootRef} />}
      </div>
    </FrameActionsContext.Provider>
  );
};
