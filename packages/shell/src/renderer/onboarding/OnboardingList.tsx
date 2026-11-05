/**
 * ONBOARDING: what a workspace's canvas shows while it has no components. A
 * "Bring your brand" card over one column of prompt cards under three tabs:
 * Use cases (jobs: a screenshot, a PRD, a decision, a demo), Ideas (things to
 * make) and Libraries (company design systems, component libraries, motion
 * and media).
 *
 * Picking a card runs its prompt in the chat sidebar: the chat that's open,
 * with its composer's model and effort, or a new one if none is (as the
 * composer's send would). The picked card stays marked.
 */
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Package, Plus } from "lucide-react";
import { cn } from "@/renderer/lib/utils";

// A plain join, as the design has it: no class is merged away.
const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
import { useConversationMessages } from "@/renderer/lib/claude-code-ops";
import { useComposerModel } from "@/renderer/hooks/use-composer-model";
import { useSendToChat } from "@/renderer/hooks/use-send-to-chat";
import { useWorkspaceStore } from "@/renderer/store/workspace";
import { ART } from "./art";
import { MARKS } from "./logos";
import {
  BRAND_SOURCES,
  IDEAS,
  LIBRARY_GROUPS,
  USE_CASES,
  type Library,
  type Pick,
  type Starter,
} from "./prompts";

type OnPick = (p: Pick) => void;

// While a picked prompt is running, the other cards are locked and dimmed;
// the picked one keeps its mark.
const LOCKED = "disabled:cursor-default disabled:opacity-50";

// --- Bring your brand ---

// Real marks for each: a brand's swatches, design systems people bring,
// a codebase's file types.
const MarkStack = ({ children }: { children: ReactNode }) => (
  <span className="flex w-[58px] shrink-0 items-center justify-center -space-x-1">{children}</span>
);
const Coin = ({ bg, children, className }: { bg: string; children: ReactNode; className?: string }) => (
  <span
    className={cx("grid size-[22px] place-items-center overflow-hidden rounded-[6px] ring-2 ring-[#2c2c2c] [&_svg]:size-3", className)}
    style={{ background: bg }}
  >
    {children}
  </span>
);
const BrandMarks = ({ kind }: { kind: "site" | "ds" | "code" }) =>
  kind === "site" ? (
    <MarkStack>
      {["#e8613a", "#f5f0e8", "#7fa38a"].map((c) => (
        <span key={c} className="size-[20px] rounded-full ring-2 ring-[#2c2c2c]" style={{ background: c }} />
      ))}
    </MarkStack>
  ) : kind === "ds" ? (
    <MarkStack>
      <Coin bg={MARKS.material.bg}>{MARKS.material.node}</Coin>
      <Coin bg={MARKS.ibm.bg}>{MARKS.ibm.node}</Coin>
      <Coin bg={MARKS.shadcn.bg}>{MARKS.shadcn.node}</Coin>
    </MarkStack>
  ) : (
    <MarkStack>
      <Coin bg="#3178c6" className="text-[8px] font-bold text-white">
        TS
      </Coin>
      <Coin bg="#663399" className="text-[6.5px] font-bold text-white">
        CSS
      </Coin>
      <Coin bg="#f7df1e" className="text-[8px] font-bold text-black">
        JS
      </Coin>
    </MarkStack>
  );

// One card, rows split by hairlines; a check replaces the + when picked.
const BrandSection = ({ selected, locked, onPick }: { selected: Pick | null; locked: boolean; onPick: OnPick }) => (
  <div className="mb-7">
    <div className="mb-3 px-0.5">
      <h1 className="text-sm font-medium text-[#b0b0b0] tracking-[-0.02em]">Bring your brand</h1>
      <p className="text-xs text-[#787878] mt-1 leading-normal">Claude builds in your look from the first prompt.</p>
    </div>
    <div className="overflow-hidden rounded-[12px] border border-[#333] bg-white/[0.035]">
      {BRAND_SOURCES.map(({ st, kind, title, does }, i) => {
        const on = selected?.id === st.id;
        return (
          <button
            key={st.id}
            onClick={() => onPick(st)}
            disabled={locked && !on}
            className={cx(
              "group flex w-full items-center gap-3 p-1.5 pr-3.5 text-left transition-colors",
              i > 0 && "border-t border-[#333]",
              on ? "bg-[#303030]" : "hover:bg-white/[0.03] disabled:hover:bg-transparent",
              LOCKED,
            )}
          >
            <BrandMarks kind={kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] leading-snug font-medium text-neutral-100">{title}</span>
              <span className="block truncate text-[11px] leading-snug text-neutral-500">{does}</span>
            </span>
            {on ? (
              <Check className="size-3.5 shrink-0 text-neutral-200" />
            ) : (
              <Plus className="size-3.5 shrink-0 text-neutral-500 group-hover:text-neutral-300" />
            )}
          </button>
        );
      })}
    </div>
  </div>
);

// --- Try a prompt ---

type ListTab = "usecases" | "ideas" | "libraries";

const LIST_TABS: { id: ListTab; label: string; hint: string }[] = [
  { id: "usecases", label: "Use cases", hint: "Start from what you're working on. Claude asks a few questions first." },
  { id: "ideas", label: "Ideas", hint: "Pick one to drop it into the chat. Claude asks a few questions before it builds." },
  { id: "libraries", label: "Libraries", hint: "Pick one and Claude installs it, then builds a first screen with it." },
];

const cardClass = (on: boolean) =>
  cx(
    "group flex items-center gap-3 rounded-[10px] border p-1.5 pr-3.5 text-left transition-colors",
    on ? "border-[#737373] bg-[#303030]" : "border-[#333] bg-[#262626] hover:border-[#4a4a4a] disabled:hover:border-[#333]",
    LOCKED,
  );

const IdeaCard = ({ st, on, locked, onPick }: { st: Starter; on: boolean; locked: boolean; onPick: OnPick }) => {
  const Art = ART[st.id];
  return (
    <button onClick={() => onPick(st)} disabled={locked && !on} className={cardClass(on)}>
      <span className="relative h-[46px] w-[72px] shrink-0 overflow-hidden rounded-[7px] bg-[#2a2a2a] ring-1 ring-white/[0.04]">
        <span className="absolute left-0 top-0 h-[260%] w-[260%] origin-top-left scale-[0.3846]">
          {Art && <Art />}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] leading-snug font-medium text-neutral-100">{st.title}</span>
        <span className="block truncate text-[11px] leading-snug text-neutral-500">{st.blurb}</span>
      </span>
    </button>
  );
};

const LibraryCard = ({ lib, on, locked, onPick }: { lib: Library; on: boolean; locked: boolean; onPick: OnPick }) => (
  <button onClick={() => onPick(lib)} disabled={locked && !on} className={cardClass(on)}>
    <span
      className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-[8px] ring-1 ring-white/[0.08]"
      style={{ background: lib.mark.bg }}
    >
      {lib.mark.node}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[12px] leading-snug font-medium text-neutral-100">{lib.name}</span>
      <span className="block truncate text-[11px] leading-snug text-neutral-500">
        {lib.by && <span className="text-neutral-400">{lib.by} · </span>}
        {lib.blurb}
      </span>
    </span>
  </button>
);

// The cards under the tabs, scrolling in a fixed height so switching tabs
// moves nothing.
const ListCards = ({
  tab,
  selected,
  locked,
  onPick,
  height,
}: {
  tab: ListTab;
  selected: Pick | null;
  locked: boolean;
  onPick: OnPick;
  height: number;
}) => (
  <div
    key={tab}
    className="overflow-y-auto"
    style={{
      height,
      scrollbarWidth: "thin",
      scrollbarColor: "#525252 transparent",
      maskImage: "linear-gradient(to bottom, black calc(100% - 28px), transparent)",
    }}
  >
    {tab !== "libraries" ? (
      <div className="flex flex-col gap-1.5 pb-6">
        {(tab === "usecases" ? USE_CASES : IDEAS).map((st) => (
          <IdeaCard key={st.id} st={st} on={selected?.id === st.id} locked={locked} onPick={onPick} />
        ))}
      </div>
    ) : (
      <div className="flex flex-col pb-6">
        {LIBRARY_GROUPS.map((g, i) => (
          <div key={g.title} className={i > 0 ? "mt-4" : ""}>
            <div className="mb-1.5 px-0.5 text-[11px] font-medium text-neutral-500">{g.title}</div>
            <div className="flex flex-col gap-1.5">
              {g.items.map((lib) => (
                <LibraryCard key={lib.id} lib={lib} on={selected?.id === lib.id} locked={locked} onPick={onPick} />
              ))}
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

// Runs a picked prompt in the chat sidebar: the chat that's open, with its
// composer's model and effort, or a new one (which sendToChat shows).
//
// One prompt at a time: a pick is ignored while one is being sent (a ref, so
// clicks in the same frame can't both get through) and while the open chat's
// turn is running, and the card that ran doesn't run again on a second click.
const useRunPrompt = () => {
  const activeConversationId = useWorkspaceStore((s) => s.activeConversationId);
  const { data: activeConversation } = useConversationMessages(activeConversationId);
  const composer = useComposerModel(activeConversationId, activeConversation);
  const sendToChat = useSendToChat();
  const [selected, setSelected] = useState<Pick | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const replying = activeConversation?.streamStatus === "streaming";

  const run = async (p: Pick) => {
    if (sendingRef.current || replying || selected?.id === p.id) return;
    sendingRef.current = true;
    setSending(true);
    setSelected(p);
    // Bring the chat into view, over the panel's chat list or the
    // Components panel, unfolded.
    const { showConversation, setActiveSidePanel } = useWorkspaceStore.getState();
    if (activeConversationId) showConversation(activeConversationId);
    else setActiveSidePanel("chat");
    try {
      await sendToChat.send({
        prompt: p.prompt,
        title: p.title,
        model: composer.selectedModelId,
        effort: composer.effort,
      });
    } catch (e) {
      console.error(e);
      setSelected(null);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return { selected, locked: sending || replying, run };
};

// The heading and tabs stay put while the cards under them scroll, so
// switching tabs doesn't move anything.
export const OnboardingList = ({ className }: { className?: string }) => {
  const { selected, locked, run } = useRunPrompt();
  const [tab, setTab] = useState<ListTab>("usecases");
  const current = LIST_TABS.find((t) => t.id === tab)!;
  return (
    <div className={cn("relative w-full max-w-[480px] px-6 py-6", className)}>
      <BrandSection selected={selected} locked={locked} onPick={run} />
      <div className="mb-3 flex items-end justify-between gap-4 px-0.5">
        <div className="min-w-0">
          <h1 className="text-sm font-medium text-[#b0b0b0] tracking-[-0.02em]">Try a prompt</h1>
          <p className="text-xs text-[#787878] mt-1 leading-normal">{current.hint}</p>
        </div>
      </div>
      <div className="mb-3 flex items-center gap-3">
        <div className="flex w-fit shrink-0 gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
          {LIST_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "h-6 rounded-md px-2.5 text-[12px] font-medium transition-colors",
                tab === t.id ? "bg-white/[0.1] text-neutral-100" : "text-neutral-500 hover:text-neutral-300",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* On every tab: the lists are examples, not the limit. */}
        <p className="ml-auto flex min-w-0 items-center gap-1.5 text-[11.5px] text-neutral-500">
          <Package className="size-3.5 shrink-0 text-neutral-500" />
          <span className="truncate">
            Or ask for <span className="text-neutral-400">any React library</span> on npm.
          </span>
        </p>
      </div>
      <ListCards tab={tab} selected={selected} locked={locked} onPick={run} height={360} />
    </div>
  );
};
