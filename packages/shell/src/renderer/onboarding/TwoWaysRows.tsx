/**
 * The two ways to work, as cards: the built-in chat, then the MCP server with
 * every agent as a row of its own ("Add" on the row, its manual steps inside
 * it). The onboarding page (./OnboardingTwoWays) shows both; the titlebar's
 * popover (components/McpSetup) shows the MCP card alone, so the rows stay
 * the same; the popover's are `compact`, a size down, to fit under the button.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Info } from "lucide-react";
import { useMountEffect } from "@/renderer/hooks/use-mount-effect";
import { useAgentStates, type State } from "./agent-states";
import { SetupPlace, trackSetup, type SetupSource } from "./setup-analytics";
import { AGENTS, AgentMark, agent, type Agent } from "./agents";
import {
  AddButton,
  AddError,
  Added,
  BODY,
  CARD,
  Config,
  FOCUS,
  Failed,
  LINE,
  META,
  ManualSteps,
  Mark,
  OtherSteps,
  Reveal,
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

/**
 * The popover's header: the agents' marks, then a line of title and one of
 * body. The rows below are the action, so it has no buttons.
 *
 * Its type is the card's (McpParts' TITLE and BODY) a size down, as the rows
 * under it are: the title leads the rows' names by its size, at their
 * weight (semibold was heavy for a popover this small), and the body is the
 * grey of a row's second line. Written out, not TITLE and BODY with a size
 * added: two sizes on one element leave which wins to the stylesheet's
 * order.
 */
const PopoverHeader = () => (
  <div className="px-3.5 pb-3.5 pt-3.5">
    {/* Overlapping by 3px: any more and each mark's ring cuts into the glyph before it. */}
    <div className="flex -space-x-[3px]">
      {(["claude", "codex", "cursor"] as const).map((id) => (
        <AgentMark key={id} a={agent(id)} size={20} ring="#2c2c2c" />
      ))}
    </div>
    <h2 className="mt-2.5 text-[14px] font-medium leading-5 tracking-[-0.01em] text-neutral-50">
      Use the agents you already have
    </h2>
    <p className="mt-0.5 text-balance text-[12.5px] leading-[18px] text-neutral-400">
      Connect Claude Code, Codex or Cursor to this canvas over MCP.
    </p>
  </div>
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

// What the row says at its right end: the button, then how it went.
const Action = ({ a, s, onAdd, compact }: { a: Agent; s: State; onAdd: () => void; compact?: boolean }) => {
  if (s === "added") return <Added />;
  if (s === "failed") return <Failed />;
  if (a.install.kind === "other") return null;
  return <AddButton a={a} s={s} onClick={onAdd} size={compact ? "xs" : "sm"} />;
};

const Row = ({
  a,
  s,
  open,
  onToggle,
  onAdd,
  error,
  compact,
  source,
}: {
  a: Agent;
  s: State;
  open: boolean;
  onToggle: () => void;
  onAdd: () => void;
  /** Why its "Add" didn't work. */
  error?: string;
  compact?: boolean;
  source: SetupSource;
}) => (
  <li className={cx(LINE, "border-t transition-colors", open && "bg-black/[0.1]")}>
    <div className={cx("group relative flex items-center", compact ? "h-11 gap-2.5 px-3.5" : "h-[52px] gap-3 px-4")}>
      {/* The whole row opens it; "Add" sits above that. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`${a.name}: set it up manually`}
        className={cx("absolute inset-0 transition-colors hover:bg-white/[0.025]", FOCUS, "focus-visible:-outline-offset-2")}
      />
      {/* A slot as wide as the header's tile, so the names line up with the title above. */}
      <span className={cx("pointer-events-none grid shrink-0 place-items-center", compact ? "w-8" : "w-9")}>
        <Mark a={a} size={compact ? 20 : 24} />
      </span>
      <div className="pointer-events-none min-w-0 flex-1">
        <div className={cx("text-[13px] font-medium text-neutral-50", compact ? "leading-4" : "leading-[18px]")}>{a.name}</div>
        {/* META a size down, written out: added to META, its size and leading lose to META's. */}
        <div className={cx("truncate", compact ? "text-[11.5px] leading-4 text-neutral-400" : META)}>
          <Config a={a} />
        </div>
      </div>
      <div className="relative">
        <Action a={a} s={s} onAdd={onAdd} compact={compact} />
      </div>
      <ChevronDown
        className={cx(
          "pointer-events-none shrink-0 text-neutral-500 transition-[transform,color] duration-200 group-hover:text-neutral-300",
          compact ? "size-3.5" : "size-4",
          open && "rotate-180 text-neutral-300",
        )}
      />
    </div>
    <Reveal open={open}>
      {/* Its copy buttons and install link count under this row's agent. */}
      <SetupPlace.Provider value={{ source, agent: a.id }}>
        <div className={compact ? "pb-3.5 pl-14 pr-3.5 pt-1" : "pb-4 pl-16 pr-4 pt-1"}>
          {/* The row's end says only "Failed": trying again is here, beside why. */}
          {error && <AddError onRetry={onAdd}>{error}</AddError>}
          {a.install.kind === "other" ? (
            <OtherSteps />
          ) : (
            <>
              <p className="mb-1.5 text-[12px] font-medium leading-4 text-neutral-300">Set it up manually</p>
              <ManualSteps id={a.id} />
            </>
          )}
        </div>
      </SetupPlace.Provider>
    </Reveal>
  </li>
);

/**
 * The MCP server's card: its header, then the agents' rows.
 * bare: no card around it, for when a popover already is one.
 * compact: a size down (44px rows, 20px marks) under a lighter header, for
 * the titlebar's popover.
 * source: where it's shown, for analytics (./setup-analytics).
 */
export const McpRows = ({ bare, compact, source }: { bare?: boolean; compact?: boolean; source: SetupSource }) => {
  const [open, setOpen] = useState<string | null>(null);
  const { state, error, add, refresh } = useAgentStates();

  // Shown: the onboarding page's step, or the titlebar's popover opened.
  useMountEffect(() => trackSetup("mcp_setup_viewed", { source }));

  // A manual step is run somewhere else (a terminal, the agent's own install
  // prompt): coming back to the window reads the configs again, so the row
  // says "Added" once it is.
  useMountEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  });

  return (
    <section className={bare ? undefined : CARD}>
      {compact ? <PopoverHeader /> : <McpHeader />}
      <ul>
        {AGENTS.map((a) => (
          <Row
            key={a.id}
            a={a}
            s={state(a.id)}
            open={open === a.id}
            onToggle={() => {
              if (open !== a.id) trackSetup("mcp_manual_steps_opened", { source, agent: a.id });
              setOpen((o) => (o === a.id ? null : a.id));
            }}
            // An "Add" that didn't work opens the row: why, over the steps to do it by hand.
            onAdd={() => void add(a.id, source).then((added) => !added && setOpen(a.id))}
            error={error(a.id)}
            compact={compact}
            source={source}
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
    <McpRows source="onboarding" />
  </>
);
