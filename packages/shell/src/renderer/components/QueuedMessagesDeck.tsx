import { useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import type { Message } from "@/main/api";
import { cn } from "@/renderer/lib/utils";
import { SMOOTH, collapseHeight } from "@/renderer/lib/motion";
import type { DeckRow } from "@/renderer/lib/use-queue-deck";
import { useCancelQueuedMessage } from "@/renderer/lib/claude-code-ops";

// Messages sent mid-turn, waiting on the CLI, between the transcript and the
// composer. Built from the QueueGhostWithSelection design: square hairline
// container hugging the right edge, centered "Queued Messages" title,
// right-aligned dimmed bubbles with the × inside. A row leaves by collapsing
// its measured height — up when accepted (the transcript takes it), right
// when cancelled.

const promptText = (message: Message) => {
  const content =
    message.sdkMessage.type === "user" ? message.sdkMessage.message.content : "";
  if (typeof content === "string") return content;
  return content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
};

type QueuedRowProps = {
  row: DeckRow;
  cancelling: boolean;
  onCancel: () => void;
};

const QueuedRow = ({ row, cancelling, onCancel }: QueuedRowProps) => {
  const ref = useRef<HTMLDivElement>(null);
  // In the same commit that applies the leaving classes, so the height and
  // the fade/translate run together.
  useLayoutEffect(() => {
    if (row.leaving) collapseHeight(ref.current);
  }, [row.leaving]);

  return (
    <div
      ref={ref}
      className={cn(
        "overflow-hidden transition-[height,opacity]",
        SMOOTH,
        row.leaving && "opacity-0",
      )}
    >
      <div
        className={cn(
          "flex justify-end py-0.5 transition-transform animate-in fade-in slide-in-from-bottom-2",
          SMOOTH,
          row.leaving === "accepted" && "-translate-y-3",
          row.leaving === "cancelled" && "translate-x-8",
        )}
      >
        {/* Dimmed against sent messages (neutral-700 / neutral-200):
            same bubble, lower opacity, quieter text. */}
        <div className="relative max-w-full rounded-lg bg-neutral-700 py-1.5 pl-2.5 pr-8 opacity-70 transition-colors duration-200">
          <p className="text-[13px] leading-snug text-neutral-400">
            {promptText(row.message)}
          </p>
          <button
            type="button"
            aria-label="Cancel queued message"
            title="Cancel queued message"
            // The CLI decides whether a cancel lands, and that answer has no
            // time bound — the row stays until it comes back.
            disabled={cancelling || row.leaving !== undefined}
            onClick={onCancel}
            className="absolute right-1 top-1 rounded-md p-1 text-neutral-500 transition-colors duration-200 hover:bg-white/[0.06] hover:text-neutral-200 disabled:pointer-events-none disabled:opacity-50"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

type QueuedMessagesDeckProps = {
  conversationId: string;
  rows: DeckRow[];
};

export const QueuedMessagesDeck = ({
  conversationId,
  rows,
}: QueuedMessagesDeckProps) => {
  const cancelQueued = useCancelQueuedMessage();

  if (rows.length === 0) return null;

  return (
    <div className="shrink-0 px-4 pt-2">
      {/* Hugs the right edge like the user bubbles it holds, instead of
          spanning the panel. */}
      <div className="ml-auto w-fit min-w-[240px] max-w-[85%] border border-[#2d2d2d] p-2 transition-colors duration-200">
        <div className="mb-1 text-center">
          <span className="text-[13px] font-medium text-neutral-500">
            Queued Messages
          </span>
        </div>
        <div>
          {rows.map((row) => (
            <QueuedRow
              key={row.message.id}
              row={row}
              // Only the row whose cancel is in flight waits on it; the
              // mutation is shared by every row.
              cancelling={
                cancelQueued.isPending &&
                cancelQueued.variables?.userMessageId === row.message.id
              }
              onCancel={() =>
                cancelQueued.mutate({
                  conversationId,
                  userMessageId: row.message.id,
                })
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
};
