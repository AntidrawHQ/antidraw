/**
 * The panel under the titlebar's Publish button. Publishing takes two steps:
 * the button opens a confirm view (where it goes, who can see it, Publish),
 * and only its Publish starts the run. The run happens in the panel as a step
 * list (the install flow's), and when the site is live the panel becomes the
 * link. Signed out, the sign-in panel comes first.
 *
 * It can't be closed while publishing: the run stays in view until it's live
 * or fails. The popover around it (PublishButton) is the dialog.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy, ExternalLink, Globe, X } from "lucide-react";
import PublishAccess from "./PublishAccess";
import PublishSteps, { type StepActions } from "./PublishSteps";
import { C, EASE_OUT, SPRING, cx, type PublishState } from "./shared";

/** Animates to its content's height as steps open, close and swap. */
const AutoHeight = ({ children }: { children: ReactNode }) => {
  const inner = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number | "auto">("auto");
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <motion.div
      animate={{ height: h }}
      initial={false}
      transition={reduce ? { duration: 0 } : { duration: 0.28, ease: EASE_OUT }}
      className="overflow-hidden"
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
};

const LinkField = ({ url }: { url: string }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <div className="flex h-10 items-center gap-1 rounded-[10px] border border-white/[0.1] bg-black/[0.18] pl-3 pr-1">
      <Globe size={13} className="shrink-0 text-neutral-500" />
      <span className="ml-1.5 min-w-0 flex-1 truncate font-mono text-[12px]" style={{ color: C.text }}>
        {url.replace(/^https?:\/\//, "")}
      </span>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(url).catch(() => {});
          setCopied(true);
        }}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[7px] bg-white/[0.08] px-2.5 text-[12px] font-medium text-neutral-200 transition-colors hover:bg-white/[0.12]"
      >
        {copied ? <Check size={12} strokeWidth={2.5} className="text-neutral-400" /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label="Open site"
        className="flex h-8 w-8 items-center justify-center rounded-[7px] text-neutral-400 transition-colors hover:bg-white/[0.08] hover:text-neutral-200"
      >
        <ExternalLink size={13} />
      </a>
    </div>
  );
};

const Header = ({ state, onClose }: { state: PublishState; onClose?: () => void }) => {
  const running = state.step !== "done" && !state.failure;
  const title = state.failure ? "Couldn't publish" : `Publishing ${state.site.name}`;
  return (
    <div>
      <div className="flex min-h-6 items-center gap-3">
        <h2 className="m-0 min-w-0 flex-1 truncate text-[15px] font-medium tracking-[-0.01em]" style={{ color: C.text }}>
          {title}
        </h2>
        {!running && (
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mr-1.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-200"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <p className="m-0 mt-1 truncate text-[12px]" style={{ color: C.muted }}>
        {state.site.url ? (
          <>
            <span className="font-mono text-[11px]">{state.site.url.replace(/^https?:\/\//, "")}</span>
            {state.site.lastPublished && <span> · live {state.site.lastPublished}</span>}
          </>
        ) : (
          "First publish."
        )}
      </p>
    </div>
  );
};

const Confirm = ({
  state,
  onClose,
  onPublish,
}: {
  state: PublishState;
  onClose?: () => void;
  onPublish?: () => void;
}) => {
  const republish = !!state.site.lastPublished;
  return (
    <div>
      <div className="flex items-center gap-3">
        <h2 className="m-0 min-w-0 flex-1 truncate text-[15px] font-medium tracking-[-0.01em]" style={{ color: C.text }}>
          Publish {state.site.name}
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mr-1.5 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-200"
        >
          <X size={14} />
        </button>
      </div>
      <p className="m-0 mt-1 truncate text-[12px]" style={{ color: C.muted }}>
        {state.site.url ? (
          <>
            <span className="font-mono text-[11px]">{state.site.url.replace(/^https?:\/\//, "")}</span>
            {state.site.lastPublished && <span> · live {state.site.lastPublished}</span>}
          </>
        ) : (
          "First publish. You'll get a new link."
        )}
      </p>
      <div className="mt-5">
        <PublishAccess />
      </div>
      <button
        type="button"
        onClick={onPublish}
        data-autofocus
        className="mt-5 flex h-9 w-full cursor-pointer items-center justify-center rounded-[10px] bg-[#e0e0e0] text-[13px] font-medium text-neutral-900 transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
      >
        {republish ? "Publish changes" : "Publish"}
      </button>
    </div>
  );
};

const Live = ({ state, onClose }: { state: PublishState; onClose?: () => void }) => {
  const republish = !!state.site.lastPublished;
  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[15px] font-medium tracking-[-0.01em]" style={{ color: C.text }}>
            {state.site.name} is live
          </h2>
          <p className="m-0 mt-0.5 text-[12px]" style={{ color: C.muted }}>
            {republish ? "Updated on the same link." : "Your link is ready to share."}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="-mr-1.5 -mt-1 flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/[0.06] hover:text-neutral-200"
        >
          <X size={14} />
        </button>
      </div>
      <div className="mt-4">
        <LinkField url={state.site.url ?? "https://antidraw.site"} />
      </div>
      <div className="mt-5">
        <PublishAccess />
      </div>
    </div>
  );
};

export default function PublishPanel({
  state,
  actions = {},
  onClose,
  className,
}: {
  state: PublishState;
  actions?: StepActions;
  onClose?: () => void;
  className?: string;
}) {
  const reduce = !!useReducedMotion();
  const done = state.step === "done";
  const confirming = state.step === "confirm";
  return (
    <div
      className={cx(
        "w-[340px] rounded-[14px] border p-5 text-left antialiased shadow-[0_24px_80px_-20px_rgba(0,0,0,0.8)]",
        className,
      )}
      style={{ background: C.panel, borderColor: C.panelBorder }}
    >
      <AutoHeight>
        <AnimatePresence mode="popLayout" initial={false}>
          {confirming ? (
            <motion.div key="confirm" exit={{ opacity: 0, transition: { duration: 0.1 } }}>
              <Confirm state={state} onClose={onClose} onPublish={actions.onPublish} />
            </motion.div>
          ) : done ? (
            <motion.div
              key="live"
              initial={{ opacity: 0, y: reduce ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SPRING}
            >
              <Live state={state} onClose={onClose} />
            </motion.div>
          ) : (
            <motion.div
              key="run"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.1 } }}
            >
              <Header state={state} onClose={onClose} />
              <div className="mt-3">
                <PublishSteps state={state} actions={actions} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </AutoHeight>
    </div>
  );
}
