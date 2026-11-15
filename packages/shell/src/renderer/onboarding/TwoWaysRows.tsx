/**
 * The two ways to work, as cards: the built-in chat, then the MCP server with
 * every agent as a row of its own ("Add" on the row, its manual steps inside
 * it). The onboarding page (./OnboardingTwoWays) shows both; the titlebar's
 * menu (./McpMenu) is the same rows at a menu's size.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { useAgentStates, type State } from "./agent-states";
import { AGENTS, agent, type Agent } from "./agents";
import {
  AddButton,
  AddError,
  Added,
  BODY,
  CARD,
  Config,
  FOCUS,
  LINE,
  META,
  ManualSteps,
  Mark,
  OtherSteps,
  Reveal,
  StatusDot,
  TITLE,
  cx,
} from "./McpParts";

const Badge = ({ children }: { children: ReactNode }) => (
  <span className="rounded-[5px] bg-white/[0.08] px-1.5 text-[11px] font-medium leading-[18px] text-neutral-300">
    {children}
  </span>
);

/**
 * The built-in chat. What it needs and what's coming are notes, not
 * controls, so they read as one quiet line instead of pills.
 */
const ChatCard = () => (
  <section className={CARD}>
    <div className="flex items-start gap-3 p-4">
      <Mark a={agent("claude")} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h2 className={TITLE}>Chat in Antidraw</h2>
          <Badge>Built in</Badge>
        </div>
        <p className={cx(BODY, "mt-1")}>Use your own Claude Code subscription with a built-in chat in your sidebar.</p>
        <p className={cx(BODY, "text-neutral-400")}>
          Nothing to set up. You'll find it in the sidebar when you open the workspace.
        </p>
        <div className={cx(META, "mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1")}>
          <span className="flex items-center gap-1.5">
            <Info className="size-3.5 text-neutral-500" />
            Needs Claude Code installed
          </span>
          <span className="size-[3px] rounded-full bg-neutral-600" />
          <span>More agents coming soon</span>
        </div>
      </div>
    </div>
  </section>
);

/** The MCP card's tile, title and body. The body is balanced, so no word is left hanging. */
const McpHeader = () => (
  <div className="flex items-start gap-3 p-4">
    <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-white/[0.06] ring-1 ring-inset ring-white/[0.08]">
      <span className="font-mono text-[10px] font-semibold tracking-[0.04em] text-neutral-200">MCP</span>
    </span>
    <div className="min-w-0 flex-1">
      <h2 className={TITLE}>Set up the MCP server</h2>
      <p className={cx(BODY, "mt-1 text-balance")}>
        Add Antidraw to Claude Code, Codex, Cursor or any agent that supports MCP. It can then read the canvas and
        build frames.
      </p>
    </div>
  </div>
);

// What the row says at its right end: the button, then what to do, then that it's done.
const Action = ({ a, s, onAdd }: { a: Agent; s: State; onAdd: () => void }) => {
  if (s === "waiting" || s === "connected")
    return (
      <span
        className={cx(
          "flex items-center gap-1.5 text-[12px] font-medium leading-[18px]",
          s === "connected" ? "text-neutral-100" : "text-neutral-200",
        )}
      >
        <StatusDot s={s} />
        {s === "connected" ? "Connected" : "Start a new session"}
      </span>
    );
  if (s === "added") return <Added />;
  if (a.install.kind === "other") return null;
  return <AddButton a={a} s={s} onClick={onAdd} size="sm" />;
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
  <li className={cx(LINE, "border-t transition-colors", open && "bg-black/[0.1]")}>
    <div className="group relative flex h-[52px] items-center gap-3 px-4">
      {/* The whole row opens it; "Add" sits above that. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${a.name}: set it up manually`}
        className={cx("absolute inset-0 transition-colors hover:bg-white/[0.025]", FOCUS, "focus-visible:-outline-offset-2")}
      />
      {/* A slot as wide as the header's tile, so the names line up with the title above. */}
      <span className="pointer-events-none grid w-9 shrink-0 place-items-center">
        <Mark a={a} size={24} />
      </span>
      <div className="pointer-events-none min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-[18px] text-neutral-50">{a.name}</div>
        <div className={cx(META, "truncate")}>
          <Config a={a} />
        </div>
      </div>
      <div className="relative">
        <Action a={a} s={s} onAdd={onAdd} />
      </div>
      <ChevronDown
        className={cx(
          "pointer-events-none size-4 shrink-0 text-neutral-500 transition-[transform,color] duration-200 group-hover:text-neutral-300",
          open && "rotate-180 text-neutral-300",
        )}
      />
    </div>
    <Reveal open={open}>
      <div className="pb-4 pl-16 pr-4 pt-1">
        {error && <AddError>{error}</AddError>}
        {a.install.kind === "other" ? (
          <OtherSteps onStarted={onStarted} />
        ) : (
          <>
            <p className="mb-1.5 text-[12px] font-medium leading-4 text-neutral-300">Set it up manually</p>
            <ManualSteps id={a.id} onStarted={onStarted} />
          </>
        )}
      </div>
    </Reveal>
  </li>
);

/** The MCP server's card: its header, then the agents' rows. */
const McpRows = () => {
  const [open, setOpen] = useState<string | null>(null);
  const { state, error, add, started } = useAgentStates();

  return (
    <section className={CARD}>
      <McpHeader />
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
    </section>
  );
};

/** The two cards; whatever holds them sets the space between. */
export const TwoWaysRows = () => (
  <>
    <ChatCard />
    <McpRows />
  </>
);
