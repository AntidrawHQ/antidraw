import { toast } from "sonner";
import { ArrowRight, X } from "lucide-react";
import antidrawIcon from "@/renderer/assets/antidraw-icon.svg";
import { CoversCanvas } from "@/renderer/lib/thumbnail";

export const AntidrawLogo = ({ size }: { size: number }) => (
  <img
    src={antidrawIcon}
    alt="Antidraw"
    className="shrink-0"
    style={{ width: size, height: size }}
  />
);

// An "Update available" notification rendered as a sonner toast.
// The action button reuses the Create-workspace / Open-workspace button
// aesthetic (rounded-[10px], glassy white/0.08 fill, arrow-style icon),
// but adds a title + description + dismiss — the richer variant we wanted.

type UpdateToastCardProps = {
  version: string;
  onRestart: () => void;
  onDismiss: () => void;
};

const UpdateToastCard = ({
  version,
  onRestart,
  onDismiss,
}: UpdateToastCardProps) => (
  <div className="relative flex w-[360px] items-start gap-3 rounded-xl border border-white/[0.06] bg-[#212121] px-4 py-3.5">
    <CoversCanvas />
    <div className="mt-0.5">
      <AntidrawLogo size={32} />
    </div>

    <div className="flex flex-1 flex-col gap-0.5 pr-4">
      <span className="text-[13px] font-medium text-neutral-100">
        Update available
      </span>
      <span className="text-[12px] leading-snug text-neutral-500">
        Version {version} has been downloaded. Restart to apply the update.
      </span>

      <div className="mt-2.5 flex items-center gap-2">
        {/* Create-workspace / Open-workspace button style */}
        <button
          onClick={onRestart}
          className="flex w-fit items-center justify-center gap-2 rounded-[10px] border border-white/[0.12] bg-white/[0.08] px-3 py-1.5 text-[13px] font-medium text-[#ccc] cursor-pointer transition-all duration-200 ease-out hover:border-white/[0.24] hover:bg-white/[0.12]"
        >
          Restart to update
          <ArrowRight size={14} />
        </button>
        <button
          onClick={onDismiss}
          className="rounded-md px-2 py-1.5 text-[13px] font-medium text-neutral-500 cursor-pointer transition-colors hover:text-neutral-300"
        >
          Later
        </button>
      </div>
    </div>

    <button
      onClick={onDismiss}
      aria-label="Dismiss"
      className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-md text-neutral-600 cursor-pointer transition-colors hover:bg-white/[0.06] hover:text-neutral-300"
    >
      <X size={14} />
    </button>
  </div>
);

// Stable id so re-showing replaces the existing toast rather than stacking
// a second one (React StrictMode double-invokes effects in development).
export const UPDATE_TOAST_ID = "update-available";

type ShowUpdateToastOptions = {
  version: string;
  onRestart: () => void;
  onDismiss: () => void;
};

// Fires the custom toast. Kept persistent (duration: Infinity) since an
// update prompt shouldn't auto-dismiss out from under the user, and not
// swipeable (dismissible: false), since a swipe would hide it without
// recording "Later". Visibility is owned by the caller — dismiss with
// toast.dismiss(UPDATE_TOAST_ID).
export const showUpdateToast = ({
  version,
  onRestart,
  onDismiss,
}: ShowUpdateToastOptions) =>
  toast.custom(
    () => (
      <UpdateToastCard
        version={version}
        onRestart={onRestart}
        onDismiss={onDismiss}
      />
    ),
    { id: UPDATE_TOAST_ID, duration: Infinity, dismissible: false },
  );
