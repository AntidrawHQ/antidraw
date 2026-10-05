import { HighlightedCode } from "@/renderer/components/ui/highlighted-code";
import { MultiFileDiff } from "@pierre/diffs/react";
import {
  langForPath,
  parseNumberedLines,
  splitShellCommand,
} from "@/renderer/lib/highlight";
import { viewableComponent, type ToolImage } from "@/renderer/lib/tool-utils";
import { cn } from "@/renderer/lib/utils";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import { memo, useMemo, useState } from "react";

export type ToolPart = {
  type: string;
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-error";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorText?: string;
};

/* ── Helpers ────────────────────────────────────────────────────────────── */

const formatValue = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
};

const getToolTitle = (toolPart: ToolPart): string => {
  const { type, input } = toolPart;
  if (typeof input?.description === "string" && input.description)
    return input.description;
  if (typeof input?.file_path === "string" && input.file_path) {
    const name = input.file_path.split("/").pop() ?? input.file_path;
    if (input.file_path.includes("/user-components/")) {
      const verb =
        type === "Write" ? "Crafting" : type === "Edit" ? "Refining" : type;
      return `${verb} ${name.replace(/\.\w+$/, "")}`;
    }
    return `${type} ${name}`;
  }
  if (typeof input?.pattern === "string" && input.pattern)
    return `${type} ${input.pattern}`;
  return type;
};

/* ── Icons ─────────────────────────────────────────────────────────────── */

// Monochrome status, from the ToolCallsMono "Ghost" design: a grey arc
// spinning while running, an outline ring with a check or × once settled.
// The spin is a transform, so it stays on the compositor.
const Spinner = () => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    className="animate-spin text-neutral-400"
  >
    <circle
      cx="12"
      cy="12"
      r="8.5"
      stroke="currentColor"
      strokeOpacity=".2"
      strokeWidth="1.75"
    />
    <path
      d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
  </svg>
);

const Ring = ({ failed }: { failed: boolean }) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="8.5" strokeOpacity=".55" />
    {failed ? (
      <path d="m9.5 9.5 5 5m0-5-5 5" />
    ) : (
      <path d="m8.75 12.25 2.25 2.25 4.25-4.75" />
    )}
  </svg>
);

/* ── Component ─────────────────────────────────────────────────────────── */

const Field = ({ name, value }: { name: string; value: unknown }) => (
  <div>
    <span className="text-neutral-500">{name}:</span> {formatValue(value)}
  </div>
);

const str = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

// Bash, with each heredoc body in the language of whatever reads it: the
// python3 script or the file a `cat >` writes, rather than one bash string.
const ShellCommand = ({ command }: { command: string }) => {
  const segments = useMemo(() => splitShellCommand(command), [command]);
  return (
    <>
      {segments.map((segment, i) => (
        <HighlightedCode key={i} code={segment.code} lang={segment.lang} />
      ))}
    </>
  );
};

const EDIT_DIFF_OPTIONS = {
  theme: "houston",
  diffStyle: "unified",
  diffIndicators: "classic",
  lineDiffType: "word",
  overflow: "wrap",
  disableFileHeader: true,
  // Numbers would count from the snippet's first line, not the file's.
  disableLineNumbers: true,
  // The strings are the context Claude chose; show all of it.
  expandUnchanged: true,
  // The theme sets its own background inline; lines and their tints mix
  // with the chat's instead.
  unsafeCSS: `pre { --diffs-bg: #262626 !important; } :host, pre, code, [data-file], [data-code] { background: transparent !important; }`,
} as const;

// The same type as the rest of the body.
const EDIT_DIFF_STYLE = {
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "11px",
  "--diffs-line-height": "1.6",
  whiteSpace: "normal",
} as React.CSSProperties;

// The strings are snippets, so a missing final newline isn't worth the diff's
// "No newline at end of file" row.
const asFile = (s: string) => (s === "" || s.endsWith("\n") ? s : `${s}\n`);

// A settled Edit as a line diff with word-level changes, coloured like the
// code side panel. @pierre/diffs highlights asynchronously, so while the
// input streams the strings render as two tinted blocks instead.
const EditDiff = ({
  name,
  oldString,
  newString,
}: {
  name: string;
  oldString: string;
  newString: string;
}) => {
  const oldFile = useMemo(
    () => ({ name, contents: asFile(oldString) }),
    [name, oldString],
  );
  const newFile = useMemo(
    () => ({ name, contents: asFile(newString) }),
    [name, newString],
  );
  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={EDIT_DIFF_OPTIONS}
      style={EDIT_DIFF_STYLE}
    />
  );
};

// The tools whose input is mostly code get it coloured; everything else lists
// its fields. Each branch reads the input defensively: while it streams, the
// partial JSON only holds the fields that have arrived so far.
const ToolInput = ({
  type,
  input,
  streaming,
}: {
  type: string;
  input: Record<string, unknown>;
  streaming: boolean;
}) => {
  const filePath = str(input.file_path);
  const lang = filePath ? langForPath(filePath) : null;
  const command = str(input.command);
  const content = str(input.content);
  const oldString = str(input.old_string);
  const newString = str(input.new_string);

  if (type === "Bash" && command !== null) {
    // The description is the row's title. The rest (timeout,
    // run_in_background, dangerouslyDisableSandbox) follow the command.
    return (
      <>
        <ShellCommand command={command} />
        {Object.entries(input).map(
          ([key, value]) =>
            key !== "command" &&
            key !== "description" && (
              <Field key={key} name={key} value={value} />
            ),
        )}
      </>
    );
  }
  if (type === "Write" && content !== null) {
    return (
      <>
        {filePath && <Field name="file_path" value={filePath} />}
        <HighlightedCode code={content} lang={lang} className="mt-1" />
      </>
    );
  }
  if (type === "Edit" && oldString !== null) {
    return (
      <>
        {filePath && <Field name="file_path" value={filePath} />}
        {input.replace_all === true && (
          <Field name="replace_all" value={true} />
        )}
        {!streaming && newString !== null ? (
          <div className="-mx-2.5 mt-1">
            <EditDiff
              name={filePath?.split("/").pop() || "file"}
              oldString={oldString}
              newString={newString}
            />
          </div>
        ) : (
          /* The tints run to the body's edges, past its padding. */
          <div className="-mx-2.5 mt-1 [&>div>div]:px-2.5">
            <HighlightedCode
              code={oldString}
              lang={lang}
              lineClassName="bg-red-400/[0.07]"
            />
            {newString !== null && (
              <HighlightedCode
                code={newString}
                lang={lang}
                lineClassName="bg-emerald-400/[0.07]"
              />
            )}
          </div>
        )}
      </>
    );
  }
  return (
    <>
      {Object.entries(input).map(([key, value]) => (
        <Field key={key} name={key} value={value} />
      ))}
    </>
  );
};

const ToolImages = ({ images }: { images: ToolImage[] }) => (
  <div className="mt-1 flex flex-col gap-2">
    {images.map((image, i) => (
      <img
        key={i}
        src={`data:${image.mediaType};base64,${image.data}`}
        alt=""
        decoding="async"
        className="max-h-80 max-w-full self-start rounded border border-white/[0.06]"
      />
    ))}
  </div>
);

// A Read result is the file with a line number on each line: coloured as the
// file, with the numbers in a gutter. A Read of an image shows the image.
// Other results stay plain text.
const ToolOutput = ({ toolPart }: { toolPart: ToolPart }) => {
  const result = str(toolPart.output?.result);
  const images = toolPart.output?.images as ToolImage[] | undefined;
  const filePath = str(toolPart.input?.file_path);
  const numbered =
    toolPart.type === "Read" && toolPart.state === "output-available" && result
      ? parseNumberedLines(result)
      : null;

  if (numbered) {
    return (
      <>
        <HighlightedCode
          code={numbered.code}
          lang={filePath ? langForPath(filePath) : null}
          lineNumbers={numbered.numbers}
          className="text-neutral-300"
        />
        {numbered.rest && <div className="mt-1">{numbered.rest}</div>}
      </>
    );
  }
  return (
    <>
      {Object.entries(toolPart.output ?? {}).map(
        ([key, value]) =>
          key !== "images" &&
          // An image's result has no text beside it.
          !(images && value === "") && (
            <div key={key}>
              {key}: {formatValue(value)}
            </div>
          ),
      )}
      {images && <ToolImages images={images} />}
    </>
  );
};

// Its own component so the input/output stringification below only runs while
// the panel is mounted. As inline JSX it ran on every render of a closed Tool,
// and a streaming Write carries its whole file in `input`.
//
// Sits in the group under a hairline, like the row's View edge.
const ToolBody = ({ toolPart }: { toolPart: ToolPart }) => {
  const { input, output, state } = toolPart;

  return (
    <div className="whitespace-pre-wrap break-all border-t border-white/[0.06] px-2.5 py-2 font-mono text-[11px] leading-[1.6]">
      {input && (
        <div className="text-neutral-300">
          <ToolInput
            type={toolPart.type}
            input={input}
            streaming={state === "input-streaming"}
          />
        </div>
      )}

      {output && (
        <div className="mt-1 text-neutral-500">
          <ToolOutput toolPart={toolPart} />
        </div>
      )}

      {state === "output-error" && toolPart.errorText && (
        <div className="mt-1 text-red-300/70">{toolPart.errorText}</div>
      )}
    </div>
  );
};

export type ToolProps = {
  toolPart: ToolPart;
  title?: string;
  defaultOpen?: boolean;
  /** Focuses the component on the canvas. Without it, no View button shows. */
  onViewComponent?: (componentName: string) => void;
  className?: string;
};

// One row of a grouped list (ToolCallsMono design): the caller's group draws
// the card and the hairlines between calls. The hover fill and colours switch
// without a transition, so hovering costs one repaint and no animation frames.
export const Tool = memo(function Tool({
  toolPart,
  title,
  defaultOpen = false,
  onViewComponent,
  className,
}: ToolProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const { state } = toolPart;

  const component = onViewComponent ? viewableComponent(toolPart) : null;
  const running = state === "input-streaming" || state === "input-available";
  const failed = state === "output-error";

  return (
    <div className={className}>
      <div className="flex items-stretch">
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((o) => !o)}
          className="group flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-2 hover:bg-white/[0.025]"
        >
          <span className="grid w-4 shrink-0 place-items-center text-neutral-500">
            {running ? <Spinner /> : <Ring failed={failed} />}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left text-[13px] text-neutral-300",
              running && "tool-shimmer",
            )}
          >
            {title ?? getToolTitle(toolPart)}
          </span>
          {failed && (
            <span className="shrink-0 text-[12px] text-red-300/70">Failed</span>
          )}
          <ChevronDown
            className={cn(
              "ml-1 size-3.5 shrink-0 text-neutral-600 transition-transform group-hover:text-neutral-400",
              isOpen && "rotate-180",
            )}
          />
        </button>

        {/* Sibling of the trigger, never a child — a nested button is invalid
            and would swallow the expand click on the way out. */}
        {component && (
          <button
            type="button"
            onClick={() => onViewComponent?.(component)}
            title={`View ${component}`}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-l border-white/[0.06] px-2.5 text-[13px] font-medium text-neutral-500 hover:bg-white/[0.025] hover:text-neutral-100"
          >
            <ArrowUpRight className="size-3.5" />
            View
          </button>
        )}
      </div>

      {isOpen && <ToolBody toolPart={toolPart} />}
    </div>
  );
});
