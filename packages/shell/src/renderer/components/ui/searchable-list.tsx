import {
  createContext,
  useContext,
  useState,
  useRef,
  useMemo,
  useEffect,
} from "react";
import type { ReactNode, RefObject } from "react";
import { Search } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { fuzzyMatch } from "@/renderer/lib/fuzzy-search";

// --- Types ---

type SearchableListItem = {
  label: string;
  indices: number[];
  data: unknown;
};

type SearchableListContextValue = {
  search: string;
  setSearch: (value: string) => void;
  selectedIndex: number;
  filtered: SearchableListItem[];
  searchInputRef: RefObject<HTMLInputElement | null>;
};

// --- Context ---

const SearchableListContext =
  createContext<SearchableListContextValue | null>(null);

export const useSearchableList = <T,>() => {
  const ctx = useContext(SearchableListContext);
  if (!ctx) {
    throw new Error(
      "useSearchableList must be used within a SearchableList"
    );
  }
  return ctx as Omit<SearchableListContextValue, "filtered"> & {
    filtered: Array<{ label: string; indices: number[]; data: T }>;
  };
};

// --- Root ---

type SearchableListProps<T> = {
  items: T[];
  getLabel: (item: T) => string;
  onSelect: (item: T) => void;
  onClose: () => void;
  autoFocus?: boolean;
  children: ReactNode;
  className?: string;
};

export const SearchableList = <T,>({
  items,
  getLabel,
  onSelect,
  onClose,
  autoFocus,
  children,
  className,
}: SearchableListProps<T>) => {
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    return items
      .map((item) => {
        const label = getLabel(item);
        return { label, ...fuzzyMatch(label, search), data: item as unknown };
      })
      .filter((item) => item.match);
  }, [items, getLabel, search]);

  // Auto-focus search input on mount
  useEffect(() => {
    if (autoFocus) {
      searchInputRef.current?.focus();
    }
  }, [autoFocus]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      onSelect(filtered[selectedIndex].data as T);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  const handleSetSearch = (value: string) => {
    setSearch(value);
    setSelectedIndex(0);
  };

  const ctx: SearchableListContextValue = {
    search,
    setSearch: handleSetSearch,
    selectedIndex,
    filtered,
    searchInputRef,
  };

  return (
    <SearchableListContext value={ctx}>
      <div className={className} onKeyDown={handleKeyDown}>
        {children}
      </div>
    </SearchableListContext>
  );
};

// --- Search Input ---

type SearchableListInputProps = {
  placeholder?: string;
  onClose?: () => void;
};

export const SearchableListInput = ({
  placeholder = "Search...",
  onClose,
}: SearchableListInputProps) => {
  const { search, setSearch, searchInputRef } = useSearchableList();

  return (
    <div className="p-2">
      <div className="flex items-center gap-2 bg-neutral-700 rounded-lg px-2.5 py-2 border border-[#2d2d2d]">
        <Search
          className={cn(
            "w-3.5 h-3.5 shrink-0",
            search ? "text-neutral-200" : "text-[#71717a]"
          )}
        />
        <input
          ref={searchInputRef}
          type="text"
          placeholder={placeholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13px] text-neutral-200 placeholder:text-neutral-500"
        />
        {onClose && (
          <button
            onClick={onClose}
            className="px-1.5 py-0.5 bg-[#2d2d2d] border-none rounded text-[10px] text-neutral-400 cursor-pointer hover:bg-neutral-600"
          >
            ESC
          </button>
        )}
      </div>
    </div>
  );
};
