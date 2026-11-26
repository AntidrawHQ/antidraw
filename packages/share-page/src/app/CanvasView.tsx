import { useMemo } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Canvas } from "@/renderer/canvas/Canvas";
import type { CanvasFile } from "@/renderer/canvas/canvas-file";
import { Shot } from "./Shot";

// The shell's canvas, read-only: each frame loads the site's Preview page.
// Frames can still be moved and resized, but nothing is saved. On its own
// module so that touch screens, which get the list instead (./touch), never
// download it.
//
// With `shot`, it is the canvas alone for its preview image (../shot.ts): no
// name over it, and <Shot> puts the view on what the picture shows and says when
// that has rendered. The canvas's own minimap and frame toolbars are hidden in app.css.

const openFullscreen = (url: string) => {
  window.open(url, "_blank", "noopener");
};

export default function CanvasView({
  file,
  frameUrl,
  shot = false,
}: {
  file: CanvasFile;
  frameUrl: (name: string) => string;
  shot?: boolean;
}) {
  // Where the frames' pages are: only they may say a frame has rendered.
  const origin = useMemo(() => new URL(frameUrl("")).origin, [frameUrl]);
  return (
    <ReactFlowProvider>
      <div className="relative h-full">
        {!shot && (
          <div className="pointer-events-none absolute left-4 top-3 z-10 text-xs font-medium text-neutral-400">
            {file.name}
          </div>
        )}
        <Canvas
          components={file.components}
          savedLayouts={file.layouts}
          frameUrl={frameUrl}
          onFullscreen={openFullscreen}
        >
          {shot && <Shot origin={origin} />}
        </Canvas>
      </div>
    </ReactFlowProvider>
  );
}
