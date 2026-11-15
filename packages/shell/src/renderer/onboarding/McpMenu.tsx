/**
 * The MCP setup at a menu's size, for the titlebar's popover
 * (components/McpSetup): what it's for, then every agent as a one-line row
 * with its "Add". A row still opens to its manual steps. Same states and
 * steps as the rows of ./TwoWaysRows; the chat and the descriptions are left
 * to the onboarding page.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useAgentStates, type State } from "./agent-states";
import { AGENTS, AgentMark, agent, type Agent } from "./agents";
import { AddButton, AddError, Added, FOCUS, ManualSteps, Mark, OtherSteps, Reveal, StatusDot, cx } from "./McpParts";

// The row's right end: the button, then what to do, then that it's done.
const Action = ({ a, s, onAdd }: { a: Agent; s: State; onAdd: () => void }) => {
  if (s === "waiting" || s === "connected")
    return (
      <span
        className={cx(
          "flex items-center gap-1 text-[12px] font-medium leading-4",
          s === "connected" ? "text-neutral-100" : "text-neutral-200",
        )}
      >
        <StatusDot s={s} />
        {s === "connected" ? "Connected" : "Start a new session"}
      </span>
    );
  if (s === "added") return <Added />;
  if (a.install.kind === "other") return null;
  // The row has no second line, so where it writes is the button's tooltip.
  return (
    <span title={`Writes antidraw into ${a.config}`}>
      <AddButton a={a} s={s} onClick={onAdd} size="xs" />
    </span>
  );
};

const Row = ({
  a,
  s,
  open,
  onToggle,
  onAdd,
  onStarted,
  error,
}: {
  a: Agent;
  s: State;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  onStarted: () => void;
  /** Why its "Add" didn't work. */
  error?: string;
}) => (
  <li>
    <div className="group relative flex h-8 items-center gap-2 pl-2 pr-1.5">
      {/* The whole row opens it; "Add" sits above that. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${a.name}: set it up manually`}
        className={cx(
          "absolute inset-0 rounded-[8px] transition-colors hover:bg-white/[0.05]",
          open && "bg-white/[0.05]",
          FOCUS,
          "focus-visible:-outline-offset-2",
        )}
      />
      <span className="pointer-events-none relative">
        <Mark a={a} size={18} />
      </span>
      <span className="pointer-events-none relative min-w-0 flex-1 truncate text-[13px] font-medium text-neutral-100">
        {a.name}
      </span>
      <div className="relative">
        <Action a={a} s={s} onAdd={onAdd} />
      </div>
      <ChevronDown
        className={cx(
          "pointer-events-none relative size-3.5 shrink-0 text-neutral-500 transition-[transform,color] duration-200 group-hover:text-neutral-300",
          open && "rotate-180 text-neutral-300",
        )}
      />
    </div>
    <Reveal open={open}>
      <div className="px-2 pb-2.5 pt-2">
        {error && <AddError>{error}</AddError>}
        {a.install.kind === "other" ? <OtherSteps onStarted={onStarted} /> : <ManualSteps id={a.id} onStarted={onStarted} />}
      </div>
    </Reveal>
  </li>
);

export const McpMenu = () => {
  const [open, setOpen] = useState<string | null>(null);
  const { state, error, add, started } = useAgentStates();

  return (
    <>
      {/* What this is, in three agents' marks and two lines. */}
      <div className="px-2 pb-2 pt-2">
        {/* Overlapping by 3px: any more and each mark's ring cuts into the glyph before it. */}
        <div className="flex -space-x-[3px]">
          {(["claude", "codex", "cursor"] as const).map((id) => (
            <AgentMark key={id} a={agent(id)} size={20} ring="#2c2c2c" />
          ))}
        </div>
        <p className="mt-2.5 text-[13px] font-semibold leading-[18px] text-white">Use the agents you already have</p>
        <p className="mt-1 text-[12.5px] leading-[1.5] text-neutral-300">
          Connect Claude Code, Codex or Cursor to this canvas over MCP.
        </p>
      </div>
      <div className="-mx-1.5 mb-1.5 mt-1 h-px bg-white/[0.07]" />
      <ul>
        {AGENTS.map((a) => (
          <Row
            key={a.id}
            a={a}
            s={state(a.id)}
            open={open === a.id}
            onToggle={() => setOpen((o) => (o === a.id ? null : a.id))}
            // An "Add" that didn't work opens the row: why, over the steps to do it by hand.
            onAdd={() => void add(a.id).then((added) => !added && setOpen(a.id))}
            onStarted={() => started(a.id)}
            error={error(a.id)}
          />
        ))}
      </ul>
    </>
  );
};
