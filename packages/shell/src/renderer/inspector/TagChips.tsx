import { Blocks, X } from "lucide-react";
import { useInspectorStore } from "./store";
import { elementName } from "./tags";

// A component, as the app names one elsewhere (the frames' labels, the
// component list): its name in the UI's face, quiet, on a faint chip, with
// the component list's icon. No border, no mono: those are for code.
const CHIP = "inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-white/[0.06] px-2 text-xs font-medium text-white/60";
const Icon = () => <Blocks className="size-3 shrink-0 text-white/35" strokeWidth={1.75} />;

// The elements tagged for the next message, in the composer.
export const TagChips = () => {
  const tags = useInspectorStore((s) => s.tags);
  const removeTag = useInspectorStore((s) => s.removeTag);
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 p-2 pb-0">
      {tags.map((tag) => (
        <span
          key={`${tag.frame}|${tag.info.ref.loc}|${tag.info.ref.index}|${tag.info.ref.path.join("/")}`}
          title={tag.info.ref.loc ?? "No source location"}
          className={CHIP}
        >
          <Icon />
          <span className="truncate">{tag.frame}</span>
          <span className="truncate text-white/35">{elementName(tag.info)}</span>
          <button
            type="button"
            aria-label={`Remove ${tag.frame} · ${elementName(tag.info)}`}
            onClick={() => removeTag(tag)}
            className="-mr-0.5 text-white/35 hover:text-white/80"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
};

// The elements a sent message was tagged with, as its bubble shows them.
export const SentTags = ({ tags }: { tags: string[] }) => (
  <div className="flex flex-wrap justify-end gap-1.5 pb-1">
    {tags.map((tag, i) => (
      <span key={i} className={CHIP}>
        <Icon />
        <span className="truncate">{tag.split(" · ")[0]}</span>
        {tag.includes(" · ") && <span className="truncate text-white/35">{tag.split(" · ").slice(1).join(" · ")}</span>}
      </span>
    ))}
  </div>
);
