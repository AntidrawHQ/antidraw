import { toast } from "sonner";
import { ArrowRight, X } from "lucide-react";
import BoringAvatar from "boring-avatars";

// Square + a blue ramp sampled from the AntiDraw app logo (the paper-cut
// waves), so the update toast is marked with the version's own generated icon.
const AVATAR_COLORS = ["#0e4e8a", "#2b72b5", "#5293cc", "#79b0dc", "#a9cbe8"];

export const WorkspaceAvatar = ({
  seed,
  size,
}: {
  seed: string;
  size: number;
}) => (
  <div
    className="rounded shrink-0 overflow-hidden"
    style={{ width: size, height: size }}
  >
    <BoringAvatar
      size={size}
      name={seed}
      variant="beam"
      colors={AVATAR_COLORS}
      square
    />
  </div>
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
    <div className="mt-0.5">
      {/* Seeded by version — every release gets its own generated logo. */}
      <WorkspaceAvatar seed={version} size={32} />
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

// Fires the custom toast. Kept persistent (duration: Infinity) since an
// update prompt shouldn't auto-dismiss out from under the user.
export const showUpdateToast = (
  { version = "1.2.0" }: { version?: string } = {},
  onRestart?: () => void,
) =>
  toast.custom(
    (id) => (
      <UpdateToastCard
        version={version}
        onRestart={() => {
          onRestart?.();
          toast.dismiss(id);
        }}
        onDismiss={() => toast.dismiss(id)}
      />
    ),
    { duration: Infinity },
  );
