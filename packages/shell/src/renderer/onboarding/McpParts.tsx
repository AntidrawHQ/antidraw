/**
 * The MCP setup's pieces, at its two sizes: the onboarding page's rows and
 * the titlebar's popover, a size down (./TwoWaysRows). One type scale
 * (15 / 13 / 12), three surfaces (page, raised card, recessed well) and one
 * hairline.
 */
import { Fragment, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArrowUpRight, Check, Copy, Loader2 } from "lucide-react";
import { openInstallPrompt, useBridge, type State } from "./agent-states";
import { agent, bridgeCommand, mcpJson, pastePrompt, type Agent, type AgentId } from "./agents";

// A plain join, as the design has it: no class is merged away.
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// Type: a title, a body and a meta size; nothing in between.
export const TITLE = "text-[15px] font-semibold leading-5 tracking-[-0.01em] text-neutral-50";
export const BODY = "text-[13px] leading-5 text-neutral-300";
export const META = "text-[12px] leading-[18px] text-neutral-400";

// Surfaces: cards sit a step above the page, wells a step below the card.
export const CARD =
  "overflow-hidden rounded-[14px] border border-white/[0.08] bg-white/[0.035] shadow-[0_1px_2px_rgba(0,0,0,0.2)]";
export const LINE = "border-white/[0.07]";
export const WELL = "bg-black/[0.16]";
export const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50";

const GREEN = "text-[#a9c3a4]";
// A caution, not an alarm: the config was left as it was.
const SAND = "#d6b98a";

/** An agent's mark; its corner radius follows its size. */
export const Mark = ({ a, size = 20 }: { a: Agent; size?: number }) => (
  <span
    className="grid shrink-0 place-items-center overflow-hidden [&_svg]:size-[56%]"
    style={{
      background: a.bg,
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.27),
      boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.1)",
    }}
  >
    {a.mark}
  </span>
);

/** Where "Add" writes the server: a path in mono, a description in sans. */
export const Config = ({ a }: { a: Agent }) => {
  if (!a.config) return <>Any agent that supports MCP</>;
  return /^[~./]/.test(a.config) ? <span className="font-mono text-[11.5px]">{a.config}</span> : <>{a.config}</>;
};

/**
 * The one-click add, the quiet button of a list of them: "sm" for the page's
 * rows, "xs" for the popover's. A row says how it went in the button's
 * place: Added, or Failed.
 */
export const AddButton = ({
  a,
  s,
  onClick,
  size,
}: {
  a: Agent;
  s: State;
  onClick: () => void;
  size: "sm" | "xs";
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={s === "adding"}
    aria-label={`Add to ${a.name}`}
    className={cx(
      "flex shrink-0 items-center gap-1.5 font-medium transition-[background-color,border-color,transform] active:scale-[0.98] disabled:active:scale-100",
      "border border-white/[0.1] bg-white/[0.07] text-[12px] text-neutral-100 hover:border-white/[0.18] hover:bg-white/[0.11]",
      size === "sm" && "h-7 rounded-[7px] px-2.5",
      size === "xs" && "h-6 rounded-[6px] px-2",
      FOCUS,
    )}
  >
    {s === "adding" && <Loader2 className="size-3.5 animate-spin" />}
    {s === "adding" ? "Adding…" : "Add"}
  </button>
);

/** In the button's place, for an agent whose config already has the server. */
export const Added = () => (
  <span className="flex h-7 shrink-0 items-center gap-1.5 text-[12px] font-medium text-neutral-300">
    <Check className={cx("size-3.5", GREEN)} strokeWidth={2.5} />
    Added
  </span>
);

/** In the button's place, for an agent whose "Add" left its config as it was. */
export const Failed = () => (
  <span className="flex h-7 shrink-0 items-center gap-1.5 text-[12px] font-medium text-neutral-200">
    <span className="grid size-3.5 place-items-center">
      <span className="size-1.5 rounded-full" style={{ background: SAND }} />
    </span>
    Failed
  </span>
);

/**
 * Why something left an agent's config as it was, over the steps to do it by
 * hand; with `onRetry`, a way to try again once whatever was wrong is put right.
 */
export const AddError = ({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) => (
  // META's size.
  <p role="alert" className="mb-2 text-pretty text-[12px] leading-[18px]" style={{ color: SAND }}>
    {children}
    {onRetry && (
      <>
        {" "}
        <button
          type="button"
          onClick={onRetry}
          className={cx(
            "rounded-[4px] font-medium underline decoration-[#d6b98a]/40 underline-offset-[3px] transition-colors hover:decoration-[#d6b98a]",
            FOCUS,
          )}
        >
          Try again
        </button>
      </>
    )}
  </p>
);

/** A row's folded part: its height and opacity ease open. */
export const Reveal = ({ open, children }: { open: boolean; children: ReactNode }) => (
  <div
    className={cx(
      "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
      open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
    )}
  >
    {/* Folded, its controls are out of the tab order and the accessibility tree. */}
    <div className="overflow-hidden" inert={!open}>
      {children}
    </div>
  </div>
);

// Copy is an icon: the command keeps the width, and wraps less.
const CopyIcon = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const copy = () => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy"}
      title={copied ? "Copied" : "Copy"}
      className={cx(
        "grid size-7 shrink-0 place-items-center rounded-[6px] transition-colors",
        copied ? GREEN : "text-neutral-400 hover:bg-white/[0.08] hover:text-neutral-100",
        FOCUS,
      )}
    >
      {copied ? <Check className="size-3.5" strokeWidth={2.5} /> : <Copy className="size-3.5" />}
    </button>
  );
};

const CODE = "rounded-[8px] bg-black/25 ring-1 ring-inset ring-white/[0.06]";

// A command's words, with "--" kept on the word after it: a wrapped line
// starts with "-- <path>" instead of ending on a stray "--".
const words = (text: string) =>
  text.split(" ").reduce<string[]>((out, w) => {
    if (out[out.length - 1] === "--") out[out.length - 1] = `-- ${w}`;
    else out.push(w);
    return out;
  }, []);

/** One command; a long one wraps between words, never inside one. */
export const CodeLine = ({ text }: { text: string }) => (
  <div className={cx(CODE, "flex items-start gap-2 py-1 pl-3 pr-1")}>
    <span className="select-none py-1 font-mono text-[12px] leading-5 text-neutral-500">$</span>
    <code className="min-w-0 flex-1 py-1 font-mono text-[12px] leading-5 text-neutral-200">
      {words(text).map((w, k) => (
        <Fragment key={k}>
          {k > 0 && " "}
          <span className="whitespace-nowrap">{w}</span>
        </Fragment>
      ))}
    </code>
    <CopyIcon text={text} />
  </div>
);

/** A few lines (a config, a prompt) under the name of where they go. */
export const CodeBlock = ({ text, label, wrap }: { text: string; label: string; wrap?: boolean }) => (
  <div className={cx(CODE, "overflow-hidden")}>
    <div className="flex items-center justify-between border-b border-white/[0.06] py-0.5 pl-3 pr-1">
      <span className="truncate font-mono text-[11px] text-neutral-400">{label}</span>
      <CopyIcon text={text} />
    </div>
    <pre
      className={cx(
        "max-h-[176px] overflow-auto px-3 py-2.5 font-mono text-[12px] leading-[18px] text-neutral-200",
        wrap ? "whitespace-pre-wrap" : "whitespace-pre",
      )}
      style={{ scrollbarWidth: "thin", scrollbarColor: "#525252 transparent" }}
    >
      {text}
    </pre>
  </div>
);

const Hint = ({ children }: { children: ReactNode }) => <p className={cx(META, "mb-2 text-pretty")}>{children}</p>;

/** Every way but the one-click button: a command, or the server's JSON and the app's own install link. */
export const ManualSteps = ({ id }: { id: AgentId }) => {
  const i = agent(id).install;
  const bridge = useBridge();
  // Why the agent's install prompt couldn't be opened.
  const [linkError, setLinkError] = useState<string | null>(null);

  if (i.kind === "command")
    return (
      <>
        <Hint>{i.hint}</Hint>
        <CodeLine text={i.command(bridge.shell)} />
      </>
    );

  if (i.kind === "link")
    return (
      <>
        <Hint>Add it to {i.where ?? `${i.app}'s MCP config`}:</Hint>
        <CodeBlock text={i.json(bridge.command)} label={i.file} />
        <button
          type="button"
          // The agent's own install prompt, which main opens.
          onClick={() => void openInstallPrompt(id).then(setLinkError)}
          className={cx(
            "mt-2.5 flex items-center gap-1 rounded-[4px] text-[12px] leading-[18px] text-neutral-300 underline decoration-white/20 underline-offset-[3px] transition-colors hover:text-neutral-50 hover:decoration-white/50",
            FOCUS,
          )}
        >
          Or install it from {i.app}
          <ArrowUpRight className="size-3.5 text-neutral-500" />
        </button>
        {linkError && (
          <div className="mt-2">
            <AddError>{linkError}</AddError>
          </div>
        )}
      </>
    );

  return null;
};

type OtherTab = "command" | "config" | "prompt";
const OTHER_TABS: { id: OtherTab; label: string; hint: string }[] = [
  { id: "command", label: "Command", hint: "Add a stdio MCP server named antidraw that runs:" },
  { id: "config", label: "Config", hint: "Or paste this into the agent's MCP config:" },
  { id: "prompt", label: "Prompt", hint: "Or ask the agent to add it for you:" },
];

/** An agent Antidraw doesn't know the config of: the command, the config, or a prompt. */
export const OtherSteps = () => {
  const [tab, setTab] = useState<OtherTab>("command");
  const bridge = useBridge();
  return (
    <>
      <div role="tablist" className={cx(WELL, "mb-3 flex w-fit gap-0.5 rounded-[8px] p-0.5")}>
        {OTHER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "h-6 rounded-[6px] px-2.5 text-[12px] font-medium transition-colors",
              tab === t.id ? "bg-white/[0.1] text-neutral-50" : "text-neutral-400 hover:text-neutral-200",
              FOCUS,
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Hint>{OTHER_TABS.find((t) => t.id === tab)!.hint}</Hint>
      {/* What an agent's server settings and config take: the absolute path, as no shell expands its ~. */}
      {tab === "command" && <CodeLine text={bridgeCommand(bridge.command)} />}
      {tab === "config" && <CodeBlock text={mcpJson(bridge.command)} label="mcp.json" />}
      {tab === "prompt" && <CodeBlock text={pastePrompt(bridge.command)} label="Prompt" wrap />}
    </>
  );
};
