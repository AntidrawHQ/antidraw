import { memo, useState } from "react";
import { ArrowUpRight, ChevronDown, Diamond } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { Tool, type ToolPart } from "@/renderer/components/ui/tool";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { useUserComponents } from "@/renderer/store/userComponents";
import { parseReportChangesInput } from "@/shared/utils/changed-components";

/**
 * ChangedComponentsCard: the components a turn created and updated, each
 * with a View that focuses it on the canvas.
 *
 * The agent renders it once the components are written, so there are no
 * loading or in-progress states: everything listed is on disk.
 *
 * The rows are the transcript's tool rows: GROUP is Chat.tsx's TOOL_GROUP,
 * TITLE and the View button's classes are components/ui/tool.tsx's.
 */

export type ChangedComponentsCardProps = {
  /** Components this turn created, by name (the file name without .tsx). */
  created: string[];
  /** Components this turn updated, by name. */
  updated: string[];
  /** Focuses the component on the canvas. */
  onView: (componentName: string) => void;
  /** Starts collapsed to its header. Defaults to open. */
  defaultOpen?: boolean;
  className?: string;
};

// Chat.tsx's TOOL_GROUP, without the rules that join adjacent tool rows.
const GROUP = "overflow-hidden rounded-md border border-white/[0.05] divide-y divide-white/[0.06]";

// tool.tsx's TITLE.
const TITLE = "min-w-0 flex-1 truncate text-left text-[13px] text-neutral-300";

// tool.tsx's View button.
const VIEW =
  "flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-l border-white/[0.06] px-2.5 text-[13px] font-medium text-neutral-400 hover:bg-white/[0.025] hover:text-neutral-100 focus-visible:text-neutral-100";

function ComponentRow({ name, onView }: { name: string; onView: (name: string) => void }) {
  return (
    <div className="flex items-stretch">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2">
        <span className="grid w-4 shrink-0 place-items-center text-neutral-500">
          <Diamond className="size-[15px]" strokeWidth={1.75} />
        </span>
        <span className={TITLE}>{name}</span>
      </div>
      <button type="button" onClick={() => onView(name)} title={`View ${name}`} className={VIEW}>
        <ArrowUpRight className="size-3.5" />
        View
      </button>
    </div>
  );
}

function Section({ title, names, onView }: { title: string; names: string[]; onView: (name: string) => void }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-0.5 text-[12px] text-neutral-500">{title}</h3>
      <div className={GROUP}>
        {names.map((name) => (
          <ComponentRow key={name} name={name} onView={onView} />
        ))}
      </div>
    </section>
  );
}

export function ChangedComponentsCard({ created, updated, onView, defaultOpen = true, className }: ChangedComponentsCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  if (created.length === 0 && updated.length === 0) return null;

  const summary = [created.length > 0 && `${created.length} new`, updated.length > 0 && `${updated.length} updated`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={cn("overflow-hidden rounded-lg border border-white/[0.07]", className)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 outline-none"
      >
        <span className="text-[13px] font-medium text-neutral-200">Changes</span>
        <span className="ml-auto text-[12px] tabular-nums text-neutral-500">{summary}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-neutral-500 transition-transform group-hover:text-neutral-300 group-focus-visible:text-neutral-300",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-white/[0.06] px-3 pb-3 pt-2.5">
          {created.length > 0 && <Section title="New components" names={created} onView={onView} />}
          {updated.length > 0 && <Section title="Updated components" names={updated} onView={onView} />}
        </div>
      )}
    </div>
  );
}

/* ── Connected ─────────────────────────────────────────────────────────── */

/**
 * The card for a report_changes call in the transcript. Shown only once the
 * call succeeded (main checked every name is on disk); while it runs there is
 * nothing to show, and a call that failed or can't be read is an ordinary
 * tool row, so its error stays visible. Names no longer on the canvas (the
 * agent later deleted or renamed them) are left out, as a tool row's View is,
 * so no View focuses nothing.
 */
export const ChangedComponents = memo(function ChangedComponents({ toolPart }: { toolPart: ToolPart }) {
  const workspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setFocusComponentName = useWorkspaceStore((s) => s.setFocusComponentName);
  const { data: userComponents } = useUserComponents(workspaceId);
  const input = parseReportChangesInput(toolPart.input);

  if (toolPart.state === "input-streaming" || toolPart.state === "input-available") return null;
  if (toolPart.state === "output-error" || !input) {
    return <Tool toolPart={toolPart} title="Report changes" className={GROUP} />;
  }

  const onCanvas = (name: string) => userComponents?.some((c) => c.name === name) ?? false;
  return (
    <ChangedComponentsCard
      created={input.created.filter(onCanvas)}
      updated={input.updated.filter(onCanvas)}
      onView={setFocusComponentName}
    />
  );
});
