/**
 * ONBOARDING: what a workspace's canvas shows while it has no components. A
 * welcome, then "Bring your brand" rows over one column of prompt cards under three tabs:
 * Use cases (jobs: a screenshot, a PRD, a decision, a demo), Ideas (things to
 * make) and Libraries (company design systems, component libraries, motion
 * and media).
 *
 * Picking a card runs its prompt in the chat sidebar: the chat that's open,
 * with its composer's model and effort, or a new one if none is (as the
 * composer's send would). The picked card stays marked.
 *
 * A "Welcome to your canvas" header sits on top. No cards or hairlines: rows
 * are set apart by spacing and a hover fill. Secondary text is at 4.5:1 or
 * better on every surface, titles a step down.
 */
import { useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Check, Package, Plus } from "lucide-react";

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

// The text greys: secondary text at 4.5:1 or better on every surface, titles
// a step down.
const TONES = { "--c-title": "#e5e5e5", "--c-sub": "#999999", "--c-em": "#d4d4d4", "--c-lead": "#999999" };

// While a picked prompt is running, the other cards are locked and dimmed;
// the picked one keeps its mark.
const LOCKED = "disabled:cursor-default disabled:opacity-50";

// --- Bring your brand ---

// Real marks for each: a brand's swatches, design systems people bring,
// a codebase's file types. The marks take the thumbnails' 72px slot so every
// title lines up.
const MarkStack = ({ children }: { children: ReactNode }) => (
  <span className="flex w-[72px] shrink-0 items-center justify-center -space-x-1">{children}</span>
);
const RING = "ring-[var(--mark-ring,#262626)]";
const Coin = ({ bg, children, className }: { bg: string; children: ReactNode; className?: string }) => (
  <span
    className={cx(`grid size-[22px] place-items-center overflow-hidden rounded-[6px] ring-2 [&_svg]:size-3 ${RING}`, className)}
    style={{ background: bg }}
  >
    {children}
  </span>
);
const BrandMarks = ({ kind }: { kind: "site" | "ds" | "code" }) =>
  kind === "site" ? (
    <MarkStack>
      {["#e8613a", "#f5f0e8", "#7fa38a"].map((c) => (
        <span key={c} className={`size-[20px] rounded-full ring-2 ${RING}`} style={{ background: c }} />
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

// Fuller titles here, saying what each does (prompts.ts keeps the short ones).
const BRAND_TITLES: Record<"site" | "ds" | "code", string> = {
  site: "Pull your brand from your website",
  ds: "Use your design system",
  code: "Pull your brand and components from your codebase",
};

// Rows set apart by space; a check replaces the + when picked.
const BrandSection = ({ selected, locked, onPick }: { selected: Pick | null; locked: boolean; onPick: OnPick }) => (
  <div className="mb-8">
    <div className="-mx-1.5 flex flex-col gap-1" style={{ "--mark-ring": "#282828" } as CSSProperties}>
      {BRAND_SOURCES.map(({ st, kind, does }) => {
        const on = selected?.id === st.id;
        return (
          <button
            key={st.id}
            onClick={() => onPick(st)}
            disabled={locked && !on}
            className={cx(
              "group flex w-full items-center gap-3 p-1.5 pr-3.5 text-left transition-colors",
              "rounded-[10px]",
              on ? "bg-[#303030]" : "hover:bg-white/[0.04] disabled:hover:bg-transparent",
              LOCKED,
            )}
          >
            <BrandMarks kind={kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-snug font-medium text-[var(--c-title)]">{BRAND_TITLES[kind]}</span>
              <span className="block truncate text-[12px] leading-snug text-[var(--c-sub)]">{does}</span>
            </span>
            {on ? (
              <Check className="size-3.5 shrink-0 text-neutral-200" />
            ) : (
              <Plus className="size-3.5 shrink-0 text-[var(--c-sub)] group-hover:text-neutral-300" />
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

// Rows set apart by space, as the brand rows above are.
const GROUP = "flex flex-col gap-1";

const cardClass = (on: boolean) =>
  cx(
    "group flex w-full items-center gap-3 p-1.5 pr-3.5 text-left transition-colors",
    "rounded-[10px]",
    on ? "bg-[#303030]" : "hover:bg-white/[0.04] disabled:hover:bg-transparent",
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
        <span className="block truncate text-[13px] leading-snug font-medium text-[var(--c-title)]">{st.title}</span>
        <span className="block truncate text-[12px] leading-snug text-[var(--c-sub)]">{st.blurb}</span>
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
      <span className="block truncate text-[13px] leading-snug font-medium text-[var(--c-title)]">{lib.name}</span>
      <span className="block truncate text-[12px] leading-snug text-[var(--c-sub)]">
        {lib.by && <span className="text-[var(--c-em)]">{lib.by} · </span>}
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
    className="overflow-y-auto -mx-1.5 px-0"
    style={{
      height,
      scrollbarWidth: "thin",
      scrollbarColor: "#525252 transparent",
      maskImage: "linear-gradient(to bottom, black calc(100% - 28px), transparent)",
    }}
  >
    {tab !== "libraries" ? (
      <div className="pb-6">
        <div className={GROUP}>
          {(tab === "usecases" ? USE_CASES : IDEAS).map((st) => (
            <IdeaCard key={st.id} st={st} on={selected?.id === st.id} locked={locked} onPick={onPick} />
          ))}
        </div>
      </div>
    ) : (
      <div className="flex flex-col pb-6">
        {LIBRARY_GROUPS.map((g, i) => (
          <div key={g.title} className={i > 0 ? "mt-5" : ""}>
            <div className="mb-1.5 text-[12px] font-medium text-[var(--c-sub)] px-2">{g.title}</div>
            <div className={GROUP}>
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
  return (
    <div className={cx("relative w-full max-w-[480px] px-6 py-6", className)} style={TONES as CSSProperties}>
      {/* The welcome, one step up from the section headings */}
      <header className="mb-8 px-0.5">
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-neutral-100">Welcome to your canvas</h1>
        <p className="mt-1.5 text-[14px] leading-[1.5] text-pretty text-[var(--c-lead)]">
          Every frame here is a real React component. Describe what you want in the chat, and Claude builds it.
        </p>
      </header>
      <BrandSection selected={selected} locked={locked} onPick={run} />
      <div className="flex items-center gap-3 mb-4">
        <div className="flex w-fit shrink-0 gap-0.5 rounded-lg bg-white/[0.04] p-0.5">
          {LIST_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "h-7 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                tab === t.id ? "bg-white/[0.1] text-neutral-100" : "text-[var(--c-sub)] hover:text-neutral-300",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* On every tab: the lists are examples, not the limit. */}
        <p className="ml-auto flex min-w-0 items-center gap-1.5 text-[12.5px] text-[var(--c-sub)]">
          <Package className="size-3.5 shrink-0 text-[var(--c-sub)]" />
          <span className="truncate">
            Or ask for <span className="text-[var(--c-em)]">any React library</span> on npm.
          </span>
        </p>
      </div>
      <ListCards tab={tab} selected={selected} locked={locked} onPick={run} height={360} />
    </div>
  );
};
