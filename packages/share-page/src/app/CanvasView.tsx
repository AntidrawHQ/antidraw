import { ReactFlowProvider } from "@xyflow/react";
import { Canvas } from "@/renderer/canvas/Canvas";
import type { CanvasFile } from "@/renderer/canvas/canvas-file";

// The shell's canvas, read-only: each frame loads the site's Preview page.
// Frames can still be moved and resized, but nothing is saved. On its own
// module so that touch screens, which get the list instead (./touch), never
// download it.

const openFullscreen = (url: string) => {
  window.open(url, "_blank", "noopener");
};

export default function CanvasView({ file, frameUrl }: { file: CanvasFile; frameUrl: (name: string) => string }) {
  return (
    <ReactFlowProvider>
      <div className="relative h-full">
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
    </ReactFlowProvider>
  );
}
