import {
  ReactFlow,
  useNodesState,
  useReactFlow,
  useStore,
  useStoreApi,
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
import { createPortal } from "react-dom";
import { cn } from "@/renderer/lib/utils";
import { useMountEffect } from "@/renderer/hooks/use-mount-effect";
import { PrioritySemaphore } from "./semaphore";
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
export const frameNodeId = (componentName: string) => `${componentName}-1`;

// A move the user made, of one frame.
export type FrameMove = {
  componentName: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
};

// For a host that edits the canvas (the shell's copy, paste and undo), from
// inside it: useCanvasControls in the canvas's children.
export type CanvasControls = {
  // Puts frames where they're told and saves it, without telling the move
  // listeners: an undo's own move isn't one to undo.
  moveFrames: (positions: { componentName: string; x: number; y: number }[]) => void;
  // Tells the move listeners of a move still being made (a run of arrow keys)
  // now, before an undo, which comes after it.
  flushMoves: () => void;
  // Each move the user makes, once it ends. Gives back an unsubscribe.
  onFramesMoved: (listener: (moves: FrameMove[]) => void) => () => void;
  // A right-click on the canvas around the frames, at a point on screen: one
  // that didn't pan it (a right-drag does). Gives back an unsubscribe.
  onPaneContextMenu: (listener: (at: { x: number; y: number }) => void) => () => void;
};

const CanvasControlsContext = createContext<CanvasControls | null>(null);

export const useCanvasControls = () => {
  const controls = useContext(CanvasControlsContext);
  if (!controls) throw new Error("useCanvasControls must be used inside the Canvas");
  return controls;
};

// How long after its last arrow key a move by the keys ends.
const MOVE_SETTLE_MS = 300;

// Pans and zooms the canvas to one component's frame. For the host's own
// controls (a component list, a "View" button): call it inside the same
// ReactFlowProvider as the canvas.
// It flies there; `{ duration: 0 }` jumps.
export const useFocusComponent = () => {
  const reactFlow = useReactFlow();
  return useCallback(
    (componentName: string, { duration = 300 }: { duration?: number } = {}) => {
      reactFlow.fitView({
        nodes: [{ id: frameNodeId(componentName) }],
        duration,
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
  onRefresh?: () => void;
  frameLayer?: FrameLayer;
  framesTakePointer?: boolean;
  onFrameActivity?: () => void;
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

// The frames' toolbars share one layer over the canvas. A pan moves the
// layer: one style write. A zoom writes each toolbar's place (its frame's
// corner, at the new zoom) straight to its element. Neither renders a
// toolbar: one renders with its frame's node, which a pan or zoom doesn't
// render. React Flow's NodeToolbar renders, and writes its place, for every
// toolbar on every step of a move.
const ToolbarLayerContext = createContext<HTMLDivElement | null>(null);

// Above the frame's top left corner (x, y on the canvas), 8px clear of it at
// any zoom. Not a CSS variable for the zoom: changing one restyles every
// element under the layer, toolbars' insides included.
const toolbarTransform = (x: number, y: number, zoom: number) =>
  `translate(${x * zoom}px, ${y * zoom}px) translateY(calc(-100% - 8px))`;

const FrameToolbar = ({
  id,
  x,
  y,
  zIndex,
  children,
}: {
  id: string;
  x: number;
  y: number;
  zIndex: number;
  children: ReactNode;
}) => {
  const layer = useContext(ToolbarLayerContext);
  const store = useStoreApi();
  if (!layer) return null;
  return createPortal(
    <div
      className="react-flow__node-toolbar canvas-frame-toolbar nodrag nopan"
      data-id={id}
      // For the layer, which places it again when the zoom changes.
      data-x={x}
      data-y={y}
      style={{
        transform: toolbarTransform(x, y, store.getState().transform[2]),
        zIndex: zIndex + 1,
      }}
    >
      {children}
    </div>,
    layer,
  );
};

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
  const { frameLayer, framesTakePointer } = useContext(FrameActionsContext);
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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && interactionMode) {
        setInteractionMode(false);
        // Handled: React Flow's own Escape on a frame (deselecting it) and a
        // host's (the shell's, clearing the selection) wait for the next.
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [interactionMode],
  );

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
            <span className="text-xs text-neutral-400">Loading...</span>
          </div>
        )}
      </div>

      {/* Overlay on top of iframe - blocks events when not in interaction mode */}
      {!interactionMode && !framesTakePointer && (
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

// A frame's node, for a host reading the canvas's (useReactFlow).
export type FrameNode = IframeReactFlowNode;

// How many frames load at once. The frames nearest the middle of the view
// go first, and a frame in view holds its place until its component has
// rendered (its first component-size message) or failed to (component-failed),
// not just until its page has loaded: the page's load comes before the
// component's own code is fetched and run, which is most of the work.
const frameLoads = new PrioritySemaphore(10);
// Each loading frame's release, for the message that says it rendered or failed.
const frameRendered = new Map<string, () => void>();
// A frame that sends neither (its component's code never arrives, or its
// runtime is from before component-failed) gives its place up this long after
// its page loads.
const RENDER_TIMEOUT_MS = 4000;

// How far a frame's middle is from the view's, in screen pixels.
const distanceFromView = (
  state: { nodeLookup: Map<string, { internals: { positionAbsolute: { x: number; y: number } }; measured?: { width?: number; height?: number } }>; transform: [number, number, number]; width: number; height: number },
  id: string,
) => {
  const node = state.nodeLookup.get(id);
  if (!node) return Infinity;
  const [tx, ty, zoom] = state.transform;
  const x = (node.internals.positionAbsolute.x + (node.measured?.width ?? 0) / 2) * zoom + tx;
  const y = (node.internals.positionAbsolute.y + (node.measured?.height ?? 0) / 2) * zoom + ty;
  return Math.hypot(x - state.width / 2, y - state.height / 2);
};

// Whether any of a frame is in the view. One that isn't doesn't render until
// it is (Chromium holds back frames out of view), so waiting for it to would
// hold its place for nothing.
const inView = (
  state: Parameters<typeof distanceFromView>[0],
  id: string,
) => {
  const node = state.nodeLookup.get(id);
  if (!node) return false;
  const [tx, ty, zoom] = state.transform;
  const left = node.internals.positionAbsolute.x * zoom + tx;
  const top = node.internals.positionAbsolute.y * zoom + ty;
  const right = left + (node.measured?.width ?? 0) * zoom;
  const bottom = top + (node.measured?.height ?? 0) * zoom;
  return right > 0 && bottom > 0 && left < state.width && top < state.height;
};

// Wrapper component that React Flow renders - defined OUTSIDE component to prevent recreation
const IframeNodeRenderer = ({
  id,
  data,
  selected,
  positionAbsoluteX,
  positionAbsoluteY,
  zIndex,
}: NodeProps<IframeReactFlowNode>) => {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const releaseRef = useRef<(() => void) | null>(null);
  // Only a selected node asks: each of them counting every node on each
  // store change (every step of a zoom) is frames × frames.
  const multiSelected = useStore((s) => selected && s.nodes.filter((n) => n.selected).length > 1);
  const { onFullscreen, onSeeCode, onRefresh, onFrameActivity } = useContext(FrameActionsContext);

  const store = useStoreApi();
  useEffect(() => {
    let cancelled = false;

    frameLoads
      .acquire(() => distanceFromView(store.getState(), id))
      .then((release) => {
        if (cancelled) {
          release();
          return;
        }
        releaseRef.current = release;
        frameRendered.set(data.componentName, release);
        setUrl(data.url);
      });

    return () => {
      cancelled = true;
      releaseRef.current?.();
      releaseRef.current = null;
      frameRendered.delete(data.componentName);
    };
  }, [data.url, data.componentName, id, store]);

  const handleLoad = useCallback(() => {
    const release = releaseRef.current;
    if (release) {
      if (inView(store.getState(), id)) setTimeout(release, RENDER_TIMEOUT_MS);
      else release();
    }
    onFrameActivity?.();
  }, [onFrameActivity, store, id]);

  const handleRefresh = useCallback(() => {
    onRefresh?.();
    setRefreshCounter((c) => c + 1);
  }, [onRefresh]);

  // The frame's own URL, not the runtime's ?fullscreen=true: that drops the
  // component's preview marker and keeps the frame agent out, and the
  // window's Comment tool needs both.
  const handleFullscreen = useCallback(() => onFullscreen(data.url), [data.url, onFullscreen]);

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
      <FrameToolbar id={id} x={positionAbsoluteX} y={positionAbsoluteY} zIndex={zIndex}>
        <PillToggleToolbar
          componentName={data.componentName}
          nodeId={id}
          selected={selected && !multiSelected}
          onRefresh={handleRefresh}
          onFullscreen={handleFullscreen}
          onSeeCode={handleSeeCode}
        />
      </FrameToolbar>
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
const miniMapNodeColor = (node: Node) => (node.selected ? "#a3a3a3" : "#737373");

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

// Where a frame is, as the host saves it.
export const frameLayoutOf = (n: IframeReactFlowNode): FrameLayout => ({
  componentName: n.data.componentName,
  x: n.position.x,
  y: n.position.y,
  width: frameWidth(n),
  height: frameHeight(n),
});

// A frame where it was saved.
const placedFrame = (
  component: CanvasComponent,
  layout: FrameLayout,
  frameUrl: (componentName: string) => string,
): IframeReactFlowNode => ({
  id: frameNodeId(component.name),
  type: "iframe" as const,
  position: { x: layout.x, y: layout.y },
  style: {
    width: clampNodeSize(layout.width),
    height: clampNodeSize(layout.height),
  },
  data: {
    url: frameUrl(component.name),
    componentName: component.name,
  },
});

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
  // Where each frame goes: as the canvas opens, and a component that arrives
  // later (a host's paste gives its place here before its file is written).
  // One without a place is lined up after the rest.
  savedLayouts: FrameLayout[] | undefined;
  // The URL a frame loads to preview the component.
  frameUrl: (componentName: string) => string;
  // Called (debounced) after frames are moved or resized. Without it, changes
  // last only as long as the page.
  onLayoutsChange?: (layouts: FrameLayout[]) => void;
  // A frame loaded or reported its size, for a host that waits for the
  // frames to settle (the shell's thumbnail).
  onFrameActivity?: () => void;
  onFullscreen: (url: string) => void;
  // Without it, frames have no See Code button.
  onSeeCode?: (componentName: string) => void;
  // A frame's Refresh button was pressed, for a host that counts it.
  onRefresh?: () => void;
  frameLayer?: FrameLayer;
  // The frames have the pointer, for a host's tool that picks in them
  // (the shell's inspector): no layer over them takes it.
  framesTakePointer?: boolean;
  // Out of sight (under the shell's dashboard): React Flow's keys, which it
  // listens for on the whole document, are off. Space would be taken from
  // what's on screen.
  keysOff?: boolean;
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
  onFrameActivity,
  onFullscreen,
  onSeeCode,
  onRefresh,
  frameLayer,
  framesTakePointer,
  keysOff = false,
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
        withLayout.push(placedFrame(component, saved, frameUrl));
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
      onLayoutsChange(nodesRef.current.map(frameLayoutOf));
    }, 500);
  }, []);

  // The user's moves (a drag, or the arrow keys on a focused frame), each
  // told to the host once, when it ends, from where its frames were before it.
  // A drag ends as it's dropped; a run of arrow keys a moment after the last.
  // Where each frame is now comes from the changes themselves: the nodes
  // aren't rendered with a change until after it's told.
  const moveStartRef = useRef(new Map<string, { x: number; y: number }>());
  const moveEndRef = useRef(new Map<string, { x: number; y: number }>());
  const draggingRef = useRef(false);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const moveListenersRef = useRef(new Set<(moves: FrameMove[]) => void>());
  const paneMenuListenersRef = useRef(new Set<(at: { x: number; y: number }) => void>());
  // React Flow tells a right-click from a right-drag's press: only with this
  // given does it hold the menu until the button's up, and unmoved.
  const handlePaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    for (const listener of paneMenuListenersRef.current) listener({ x: event.clientX, y: event.clientY });
  }, []);

  const flushMoves = useCallback(() => {
    clearTimeout(moveTimerRef.current);
    const started = moveStartRef.current;
    const ended = moveEndRef.current;
    if (started.size === 0) return;
    moveStartRef.current = new Map();
    moveEndRef.current = new Map();
    const moves: FrameMove[] = [];
    for (const [id, from] of started) {
      const node = nodesRef.current.find((n) => n.id === id);
      const to = ended.get(id);
      if (!node || !to || (to.x === from.x && to.y === from.y)) continue;
      moves.push({ componentName: node.data.componentName, from, to });
    }
    if (moves.length > 0) for (const listener of moveListenersRef.current) listener(moves);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimeoutRef.current);
      clearTimeout(moveTimerRef.current);
    };
  }, []);

  const trackMoves = useCallback(
    (changes: NodeChange<IframeReactFlowNode>[]) => {
      // A resize from the top or left edge moves its frame too: that's a resize.
      if (changes.some((c) => c.type === "dimensions" && c.resizing)) return;
      const moves = changes.flatMap((c) => (c.type === "position" && c.position ? [{ ...c, position: c.position }] : []));
      if (moves.length === 0) return;
      const dragging = moves.some((c) => c.dragging);
      // A drag begun while the move before it is still settling: that one
      // ends first, as its own.
      if (dragging && !draggingRef.current) flushMoves();
      for (const c of moves) {
        if (!moveStartRef.current.has(c.id)) {
          // The nodes as last rendered: before this change.
          const node = nodesRef.current.find((n) => n.id === c.id);
          if (node) moveStartRef.current.set(c.id, { ...node.position });
        }
        moveEndRef.current.set(c.id, { ...c.position });
      }
      clearTimeout(moveTimerRef.current);
      if (dragging) {
        draggingRef.current = true;
      } else if (draggingRef.current) {
        draggingRef.current = false;
        flushMoves();
      } else {
        moveTimerRef.current = setTimeout(flushMoves, MOVE_SETTLE_MS);
      }
    },
    [flushMoves],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<IframeReactFlowNode>[]) => {
      trackMoves(changes);
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
    [onNodesChange, scheduleSave, trackMoves],
  );

  const controls = useMemo<CanvasControls>(
    () => ({
      moveFrames: (positions) => {
        flushMoves();
        const ids = new Set(nodesRef.current.map((n) => n.id));
        const changes: NodeChange<IframeReactFlowNode>[] = positions
          .map((p) => ({ id: frameNodeId(p.componentName), type: "position" as const, position: { x: p.x, y: p.y } }))
          .filter((c) => ids.has(c.id));
        if (changes.length === 0) return;
        settlingRef.current = [];
        onNodesChange(changes);
        scheduleSave();
      },
      flushMoves,
      onFramesMoved: (listener) => {
        moveListenersRef.current.add(listener);
        return () => moveListenersRef.current.delete(listener);
      },
      onPaneContextMenu: (listener) => {
        paneMenuListenersRef.current.add(listener);
        return () => paneMenuListenersRef.current.delete(listener);
      },
    }),
    [flushMoves, onNodesChange, scheduleSave],
  );

  const handleNodesChangeRef = useRef(handleNodesChange);
  handleNodesChangeRef.current = handleNodesChange;

  const onFrameActivityRef = useRef(onFrameActivity);
  onFrameActivityRef.current = onFrameActivity;

  useMountEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const type = event.data?.type;
      if (type !== "component-size" && type !== "component-failed") return;
      const { componentName, width, height } = event.data;

      const node = nodesRef.current.find(
        (n) => n.data.componentName === componentName,
      );
      // Only the frames' own origin may size them: on the web the canvas sits
      // on a page any other window can post to.
      if (!node || event.origin !== new URL(node.data.url).origin) return;
      // Rendered, or never will be: its place in the loading queue is free.
      frameRendered.get(componentName)?.();
      if (type === "component-failed") return;
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
      onFrameActivityRef.current?.();
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });

  const savedLayoutsRef = useRef(savedLayouts);
  savedLayoutsRef.current = savedLayouts;

  const reactFlow = useReactFlow();

  // Sync nodes with the component list when it changes: a frame for each new
  // component, where it's saved to go (savedLayouts, as they are now) or else
  // lined up after the rest, and none for one that's gone (its file deleted).
  // React Flow's selection is a flag on the node and a frame's load slot is
  // freed as it unmounts, so only settlingRef has to forget it. (The host
  // drops its own selection in a deleted frame.)
  useEffect(() => {
    const layoutMap = new Map((savedLayoutsRef.current ?? []).map((l) => [l.componentName, l]));
    const shown = new Set(nodesRef.current.map((n) => n.data.componentName));
    const arriving = components.filter((c) => !shown.has(c.name));

    setNodes((currentNodes) => {
      const componentNames = new Set(components.map((c) => c.name));
      const existingComponentNames = new Set(
        currentNodes.map((n) => n.data.componentName)
      );
      const newComponents = components.filter(
        (c) => !existingComponentNames.has(c.name)
      );
      const keptNodes = currentNodes.filter((n) =>
        componentNames.has(n.data.componentName),
      );

      if (newComponents.length === 0 && keptNodes.length === currentNodes.length) {
        return currentNodes;
      }

      const placed = newComponents.filter((c) => layoutMap.has(c.name));
      const unplaced = newComponents.filter((c) => !layoutMap.has(c.name));

      // Recomputed from the nodes, not appended to, as StrictMode runs this
      // updater twice. A frame given its place is the user's doing (a paste),
      // like picking a frame: the rest stay put.
      const keptIds = new Set(keptNodes.map((n) => n.id));
      settlingRef.current = [
        ...new Set([
          ...(placed.length > 0 ? [] : settlingRef.current.filter((id) => keptIds.has(id))),
          ...unplaced.map((component) => frameNodeId(component.name)),
        ]),
      ];
      return lineUp(
        [
          ...keptNodes,
          ...placed.map((c) => placedFrame(c, layoutMap.get(c.name)!, frameUrl)),
          ...unplaced.map((c) => newFrame(c, frameUrl)),
        ],
        settlingRef.current,
      );
    });

    // A placed frame's layout is saved even if its component never sizes it.
    if (arriving.some((c) => layoutMap.has(c.name))) scheduleSave();
    // The first frames of an empty canvas: brought into view, as the frames
    // the canvas opens with are.
    if (shown.size === 0 && arriving.length > 0) void reactFlow.fitView();
  }, [components, frameUrl, setNodes, scheduleSave, reactFlow]);

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

  // The toolbars' layer (FrameToolbar), kept in step with the viewport.
  const domNode = useStore((s) => s.domNode);
  const toolbarHost = useMemo(() => domNode?.querySelector(".react-flow__renderer") ?? null, [domNode]);
  const [toolbarLayer, setToolbarLayer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!toolbarLayer) return;
    let panned = "";
    let zoomed = NaN;
    const follow = () => {
      const [x, y, zoom] = store.getState().transform;
      const pan = `translate(${x}px, ${y}px)`;
      if (pan !== panned) {
        panned = pan;
        toolbarLayer.style.transform = pan;
      }
      if (zoom !== zoomed) {
        zoomed = zoom;
        for (const toolbar of toolbarLayer.children) {
          const { x, y } = (toolbar as HTMLElement).dataset;
          (toolbar as HTMLElement).style.transform = toolbarTransform(Number(x), Number(y), zoom);
        }
      }
    };
    follow();
    return store.subscribe(follow);
  }, [store, toolbarLayer]);

  const touch = useCoarsePointer();

  const focusMiniMapNode = useCallback(
    (_: React.MouseEvent, node: IframeReactFlowNode) => {
      reactFlow.fitView({ nodes: [{ id: node.id }], duration: 300, padding: 0.3 });
    },
    [reactFlow],
  );

  const frameActions = useMemo(
    () => ({
      onFullscreen,
      onSeeCode,
      onRefresh,
      frameLayer,
      framesTakePointer,
      onFrameActivity,
    }),
    [onFullscreen, onSeeCode, onRefresh, frameLayer, framesTakePointer, onFrameActivity],
  );

  return (
    <CanvasControlsContext.Provider value={controls}>
    <FrameActionsContext.Provider value={frameActions}>
     <ToolbarLayerContext.Provider value={toolbarLayer}>
      <div className={cn("h-full w-full bg-[#282828] relative", className)}>
        <ReactFlow
          nodes={nodes}
          onNodesChange={handleNodesChange}
          onPaneContextMenu={handlePaneContextMenu}
          nodeTypes={nodeTypes}
          fitView
          maxZoom={8}
          minZoom={0.05}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
          selectNodesOnDrag={true}
          selectionOnDrag={!touch}
          selectionMode={SelectionMode.Partial}
          panOnScroll={true}
          // React Flow's default (0.5) pans at half the trackpad's distance,
          // which feels heavy next to a scrolling page.
          panOnScrollSpeed={1.2}
          panOnDrag={touch ? true : [1, 2]}
          panActivationKeyCode={keysOff ? null : "Space"}
          // A frame is a file: React Flow's Backspace would only hide it, until
          // the canvas next opened. A host that deletes frames binds its own.
          deleteKeyCode={null}
          // undefined: React Flow's own default for each.
          selectionKeyCode={keysOff ? null : undefined}
          multiSelectionKeyCode={keysOff ? null : undefined}
          zoomActivationKeyCode={keysOff ? null : undefined}
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
        {toolbarHost && createPortal(<div ref={setToolbarLayer} className="canvas-toolbar-layer" />, toolbarHost)}
      </div>
     </ToolbarLayerContext.Provider>
    </FrameActionsContext.Provider>
    </CanvasControlsContext.Provider>
  );
};
