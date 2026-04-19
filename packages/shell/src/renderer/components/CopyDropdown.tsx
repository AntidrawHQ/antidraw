import { useState, useCallback, useRef } from "react";
import { Bot, Code, ChevronDown, ChevronUp } from "lucide-react";
import { IconCircleCheckFilled } from "@tabler/icons-react";
import {
  Popover,
  PopoverAnchor,
  PopoverTrigger,
  PopoverContent,
} from "@/renderer/components/ui/popover";

type CopyDropdownProps = {
  code: string;
  filePath: string;
};

export const CopyDropdown = ({ code, filePath }: CopyDropdownProps) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doCopy = useCallback(
    (text: string, label: string) => {
      navigator.clipboard.writeText(text).catch(() => {});
      setCopied(label);
      setOpen(false);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(null), 1500);
    },
    []
  );

  const prompt = `Implement a React component based on the design source of truth at: ${filePath}\n\nRead the file at that path — it is the definitive reference. Create the component 1:1, matching the exact structure, props, and logic. Pay close attention to all hardcoded values — spacing, padding, margins, font sizes, border radii, colors, opacity values, and any other design tokens must be translated exactly as written. Do not approximate or substitute with similar values.`;

  const items = [
    {
      key: "prompt",
      icon:
        copied === "prompt" ? (
          <IconCircleCheckFilled size={18} color="#7c6cd6" />
        ) : (
          <Bot size={18} strokeWidth={1.5} />
        ),
      title: "Copy Prompt For Agents",
      desc: "Copy a prompt to replicate the component in your project. Includes the file path to the component source with some additional instructions.",
      action: () => doCopy(prompt, "prompt"),
    },
    {
      key: "code",
      icon:
        copied === "code" ? (
          <IconCircleCheckFilled size={18} color="#7c6cd6" />
        ) : (
          <Code size={18} strokeWidth={1.5} />
        ),
      title: "Copy Code",
      desc: "Just the source code of the component",
      action: () => doCopy(code, "code"),
    },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="flex items-center bg-white/[0.06] rounded-lg overflow-hidden">
          <button
            onClick={() => doCopy(prompt, "prompt")}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-transparent border-none cursor-pointer hover:bg-white/[0.06] transition-[background] duration-[120ms]"
          >
            {copied ? (
              <IconCircleCheckFilled size={14} color="#7c6cd6" />
            ) : (
              <Bot size={12} className="text-[#a3a3a3]" />
            )}
            <span className="text-[13px] font-medium text-[#e5e5e5] whitespace-nowrap">
              {copied ? "Copied!" : "Copy Prompt For Agents"}
            </span>
          </button>
          <div className="w-px h-4 bg-white/10 shrink-0" />
          <PopoverTrigger asChild>
            <button className="flex items-center justify-center w-8 self-stretch bg-transparent border-none cursor-pointer hover:bg-white/[0.06] transition-[background] duration-[120ms]">
              {open ? (
                <ChevronUp size={12} className="text-[#737373]" />
              ) : (
                <ChevronDown size={12} className="text-[#737373]" />
              )}
            </button>
          </PopoverTrigger>
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="end"
        sideOffset={6}
        className="z-[200] w-[300px] p-1.5 bg-[#2c2c2c] border border-white/[0.08] rounded-xl shadow-[0_10px_38px_rgba(0,0,0,0.35),0_10px_20px_rgba(0,0,0,0.2)] flex flex-col gap-0.5"
      >
        {items.map((item) => (
          <button
            key={item.key}
            onClick={item.action}
            className="w-full flex items-center gap-2.5 p-2 border-none rounded-lg bg-transparent cursor-pointer text-left hover:bg-white/[0.06] transition-[background] duration-[120ms]"
          >
            <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0 text-[#a3a3a3]">
              {item.icon}
            </div>
            <div className="flex flex-col gap-px min-w-0">
              <span className="text-[13px] font-medium text-neutral-400">
                {item.title}
              </span>
              <span className="text-[11px] text-[#71717a]">{item.desc}</span>
            </div>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
};
