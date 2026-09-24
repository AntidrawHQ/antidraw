import { StrictMode, Suspense, use } from "react";
import { createRoot } from "react-dom/client";
import { ReactFlowProvider } from "@xyflow/react";
import { Canvas, GridPattern, useFocusComponent } from "@/renderer/canvas/Canvas";
import { ComponentList } from "@/renderer/canvas/ComponentList";
import { ResizablePanel } from "@/renderer/components/ui/resizable-panel";
import type { CanvasFile } from "./canvas-file";
import "./viewer.css";

// The published viewer: the shell's canvas, read-only, served from the same
// origin as the workspace build (whose Preview page answers at /preview).
// Frames can still be moved and resized; nothing is saved.

const canvasFile: Promise<CanvasFile> = fetch("/canvas.json").then((res) => {
  if (!res.ok) throw new Error(`canvas.json: ${res.status}`);
  return res.json();
});

const frameUrl = (componentName: string) =>
  new URL(`/preview?componentName=${encodeURIComponent(componentName)}`, location.origin)
    .href;

const openFullscreen = (url: string) => {
  window.open(url, "_blank", "noopener");
};

const Message = ({ text }: { text: string }) => (
  <div className="relative flex h-full items-center justify-center">
    <GridPattern />
    <div className="z-10 text-sm text-neutral-500">{text}</div>
  </div>
);

const Components = ({ components }: { components: CanvasFile["components"] }) => {
  const focusComponent = useFocusComponent();
  return <ComponentList components={components} onSelect={focusComponent} />;
};

const Viewer = () => {
  const file = use(canvasFile);
  document.title = file.name;

  if (file.components.length === 0) return <Message text="Nothing here yet" />;

  return (
    <ReactFlowProvider>
      <div className="flex h-full overflow-hidden">
        {/* Phones get the canvas alone */}
        <ResizablePanel className="hidden md:flex bg-neutral-800">
          <Components components={file.components} />
        </ResizablePanel>
        <div className="relative flex-1 md:border-l md:border-[#333]">
          <div className="pointer-events-none absolute left-4 top-3 z-10 text-xs font-medium text-neutral-400">
            {file.name}
          </div>
          <Canvas
            components={file.components}
            savedLayouts={file.layouts}
            frameUrl={frameUrl}
            onFullscreen={openFullscreen}
          />
        </div>
      </div>
    </ReactFlowProvider>
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<Message text="Loading…" />}>
      <Viewer />
    </Suspense>
  </StrictMode>,
);
