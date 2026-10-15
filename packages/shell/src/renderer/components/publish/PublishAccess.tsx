/**
 * Who can see a published site, as share dialogs put it (Figma, Google Drive):
 * a "General access" row. There is only one setting today, public to anyone
 * with the link, so it's stated rather than offered as a menu, and a quiet
 * note says team-only links are on the way.
 */
import { Globe, Info } from "lucide-react";
import { C } from "./shared";

export default function PublishAccess() {
  return (
    <div>
      <p className="m-0 text-[11px] font-medium text-[#9a9a9a]">General access</p>

      <div className="mt-2 flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06]">
          <Globe size={14} className="text-neutral-400" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13px]" style={{ color: C.text }}>
            Anyone with the link
          </p>
          <p className="m-0 mt-px text-[11.5px] text-[#9a9a9a]">Public. No sign-in needed to view.</p>
        </div>
        <span className="shrink-0 text-[12px] text-[#9a9a9a]">Can view</span>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2">
        <Info size={12} className="mt-[2.5px] shrink-0 text-[#9a9a9a]" />
        <p className="m-0 text-[11.5px] leading-[1.5] text-neutral-400">
          Links are public for now. Team-only publishing is coming soon.
        </p>
      </div>
    </div>
  );
}
