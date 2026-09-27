import { Info } from "lucide-react";
import type { ExclusionReason, PublishResult } from "@/main/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/renderer/components/ui/dialog";

/* ────────────────────────────────────────────────────────────
   What a publish left out: files the snapshot skipped (with the
   reason), .gitignore rules that matched many files, site files
   that were not published, and notes such as .env files the
   build could not see. Opened from the published toast.
   ──────────────────────────────────────────────────────────── */

const REASONS: Record<ExclusionReason, string> = {
  "always-excluded": "Never published",
  secret: "May contain secrets",
  gitignored: "Ignored by .gitignore",
  "symlink-outside": "Link to a file outside the canvas",
  "symlink-to-excluded": "Link to an excluded file",
  "symlink-directory": "Link to a folder",
  "symlink-broken": "Broken link",
  "not-a-regular-file": "Not a regular file",
  "unsupported-name": "Unsupported file name",
  unreadable: "Couldn't be read",
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

// Entries (directories count once) plus every file a collapsed rule matched.
export const countNotIncluded = (excluded: PublishResult["excluded"]) =>
  excluded.listed.length +
  excluded.grouped.reduce((sum, group) => sum + group.count, 0);

const Section = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="flex flex-col gap-1.5">
    <h3 className="text-[11px] font-medium uppercase tracking-[0.06em] text-neutral-500">
      {title}
    </h3>
    {children}
  </section>
);

export const PublishDetails = ({
  open,
  onOpenChange,
  result,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: PublishResult;
}) => {
  const { excluded, notes, site } = result;
  const nothing =
    excluded.listed.length === 0 &&
    excluded.grouped.length === 0 &&
    site.skipped.length === 0 &&
    notes.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(560px,80vh)] grid-rows-[auto_minmax(0,1fr)] border-[#2d2d2d] bg-[#2c2c2c] font-sans text-[#e0e0e0] antialiased">
        <DialogHeader>
          <DialogTitle className="text-base font-medium tracking-[-0.01em] text-[#e0e0e0]">
            What was published
          </DialogTitle>
          <DialogDescription className="text-[13px] leading-[1.6] text-[#9a9a9a]">
            {result.snapshot.fileCount} files in the snapshot,{" "}
            {result.site.fileCount} on the site. Anyone who remixes this
            canvas gets the snapshot.
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 flex min-h-0 flex-col gap-5 overflow-y-auto pr-2">
          {notes.map((note) => (
            <div
              key={note.code}
              className="flex gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.04] p-3 text-[12px] leading-[1.6] text-[#c8c8c8]"
            >
              <Info size={14} className="mt-0.5 shrink-0 text-neutral-400" />
              <div>
                {note.message}
                <div className="mt-1 font-mono text-[11px] text-neutral-500">
                  {note.paths.join(", ")}
                </div>
              </div>
            </div>
          ))}

          {excluded.listed.length > 0 && (
            <Section title="Not included">
              <ul className="flex flex-col">
                {excluded.listed.map((item) => (
                  <li
                    key={item.path}
                    className="flex items-baseline justify-between gap-4 border-b border-white/[0.04] py-1.5 last:border-b-0"
                  >
                    <span className="min-w-0 truncate font-mono text-[12px] text-[#e0e0e0]">
                      {item.path}
                    </span>
                    <span className="shrink-0 text-right text-[11px] text-neutral-500">
                      {REASONS[item.reason] ?? item.reason}
                      {item.rule && (
                        <span className="font-mono">
                          {" "}
                          · {item.rule}
                          {item.ignoreFile && item.ignoreFile !== ".gitignore"
                            ? ` (${item.ignoreFile})`
                            : ""}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {excluded.grouped.length > 0 && (
            <Section title="Ignored by .gitignore rules">
              <ul className="flex flex-col gap-2">
                {excluded.grouped.map((group) => (
                  <li
                    key={`${group.ignoreFile}\0${group.rule}`}
                    className="text-[12px] text-[#c8c8c8]"
                  >
                    <span className="font-mono text-[#e0e0e0]">{group.rule}</span>{" "}
                    in <span className="font-mono">{group.ignoreFile}</span>:{" "}
                    {group.count} files
                    <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">
                      {group.examples.join(", ")}
                      {group.count > group.examples.length ? ", …" : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {site.skipped.length > 0 && (
            <Section title="Not on the site">
              <p className="text-[12px] text-[#9a9a9a]">
                Hidden files from the build are not served.
              </p>
              <ul className="flex flex-col">
                {site.skipped.map((p) => (
                  <li
                    key={p}
                    className="truncate py-1 font-mono text-[12px] text-[#e0e0e0]"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {nothing && (
            <p className="text-[13px] text-[#9a9a9a]">
              Every file in the canvas was included.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
