import { RefreshCw, Unplug } from "lucide-react";

type StreamErrorProps = {
  onReconnect: () => void;
};

// Sits directly above the composer rather than in the transcript: this is a
// state of the connection, not something that happened at a point in the
// conversation, and it stays until it is acted on.
//
// Stacked rather than one row. The panel this lives in is resizable and
// routinely narrow, and a button sharing a line with the message squeezes it
// into a two-word column.
export const StreamError = ({ onReconnect }: StreamErrorProps) => (
  <div className="mb-2 py-2.5 px-3 rounded-md bg-amber-500/[0.07] border border-amber-500/20">
    <div className="flex items-start gap-2">
      <Unplug size={14} className="mt-0.5 shrink-0 text-amber-500/80" />
      <p className="text-[13px] text-neutral-300 leading-snug">
        Lost the connection to this conversation. New activity won't show up
        until you reconnect.
      </p>
    </div>
    <button
      onClick={onReconnect}
      className="mt-2 ml-[22px] flex items-center gap-1.5 py-1 px-2 bg-white/[0.06] border border-white/[0.1] rounded cursor-pointer text-[13px] font-medium text-neutral-200 transition-colors hover:bg-white/[0.1]"
    >
      <RefreshCw size={12} />
      Reconnect
    </button>
  </div>
);
