import { X } from "lucide-react";
import { useInspectorStore } from "./store";
import { elementName } from "./tags";

// The elements tagged for the next message, in the composer. Placeholder UI.
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
          className="inline-flex items-center gap-1 rounded-md border border-neutral-600 bg-neutral-800 px-2 py-0.5 font-mono text-[11px] text-neutral-200"
        >
          {tag.frame} · {elementName(tag.info)}
          <button
            type="button"
            aria-label={`Remove ${tag.frame} · ${elementName(tag.info)}`}
            onClick={() => removeTag(tag)}
            className="text-neutral-400 hover:text-white"
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
};
