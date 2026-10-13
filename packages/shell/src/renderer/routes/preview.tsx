import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PreviewWindow } from "@/renderer/PreviewWindow";
import { isPreviewUrl } from "@/shared/utils/preview-url";

// A frame's own window, opened from its toolbar (main.ts
// "open-preview-window"), outside the main window's chrome. Only a dev
// server's preview page: the window frames whatever `url` names.

const previewSearch = z.object({
  url: z.string().refine(isPreviewUrl, "Not a dev server's preview URL"),
  // The workspace it's from, for its comments. Without one, no Comment tool.
  workspace: z.uuid().optional().catch(undefined),
});

// Still a window to drag and close, with nothing in it to show.
const PreviewError = () => (
  <div className="flex h-screen w-full flex-col bg-[#0a0a0a]">
    <div className="h-[38px] w-full shrink-0 border-b border-[#333] bg-[#2A2A2A] drag-region" />
    <p className="m-auto text-[13px] text-neutral-500">Nothing to preview here.</p>
  </div>
);

const Preview = () => {
  const { url, workspace } = Route.useSearch();
  return <PreviewWindow url={url} workspaceId={workspace ?? null} />;
};

export const Route = createFileRoute("/preview")({
  validateSearch: previewSearch,
  errorComponent: PreviewError,
  component: Preview,
});
