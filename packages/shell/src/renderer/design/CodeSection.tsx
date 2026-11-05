/**
 * The right panel's Code section: the source of the component whose See
 * Code was picked last, with the Copy menu above it.
 */
import { useEffect, useState } from "react";
import { Code, FileWarning } from "lucide-react";
import { preloadHighlighter } from "@pierre/diffs";
import { File as DiffsFile } from "@pierre/diffs/react";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useComponentSource } from "@/renderer/store/userComponents";
import { cn } from "@/renderer/lib/utils";
import { CopyDropdown } from "./CopyDropdown";
import { MONO } from "./dial";
import { Empty } from "./sections";

const BG = "#2A2A2A";

const THEME = "houston";

// The viewer mounted before its highlighter has loaded draws nothing and
// waits on the load, which it doesn't always see through. So the
// highlighter loads with the app, and the viewer mounts once it has.
let highlighterReady = false;
const highlighter = preloadHighlighter({ themes: [THEME], langs: ["tsx"] })
  .catch(() => {})
  .then(() => {
    highlighterReady = true;
  });
const useHighlighterReady = () => {
  const [ready, setReady] = useState(highlighterReady);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void highlighter.then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
};

const DIFFS_OPTIONS = {
  theme: THEME,
  overflow: "scroll" as const,
  disableFileHeader: true,
  unsafeCSS: `:host, pre,code, [data-file], [data-code] { background-color: ${BG} !important; background: ${BG} !important; }`,
};

const DIFFS_STYLE = {
  height: "100%",
  overflow: "auto",
  backgroundColor: BG,
  "--diffs-bg": BG,
  "--diffs-dark-bg": BG,
  "--diffs-light-bg": BG,
} as React.CSSProperties;

export const CodeSection = () => {
  const componentName = useWorkspaceStore((s) => s.codePanelComponentName);
  const { data, isError } = useComponentSource(componentName);
  const ready = useHighlighterReady();

  if (!componentName)
    return (
      <Empty
        icon={Code}
        title="Pick a component"
        body="Hover a frame on the canvas and choose See Code to read its source here, and copy it or a prompt for your agent."
      />
    );
  if (isError)
    return (
      <Empty
        icon={FileWarning}
        title="Couldn't read the source"
        body={`${componentName}'s file couldn't be read. It may have been renamed or removed.`}
      />
    );
  // On its way.
  if (!data || !ready) return null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#333] py-2 pl-3 pr-2">
        <span
          title={data.filePath}
          className={cn(MONO, "min-w-0 truncate text-[12px] text-white/70")}
        >
          {data.fileName}
        </span>
        <div className="flex min-w-0 justify-end">
          <CopyDropdown code={data.source} filePath={data.filePath} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <DiffsFile
          file={{ name: data.fileName, contents: data.source }}
          options={DIFFS_OPTIONS}
          style={DIFFS_STYLE}
        />
      </div>
    </div>
  );
};
