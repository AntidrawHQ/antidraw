import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { Code, RefreshCw, Maximize2 } from "lucide-react";
import { Toolbar, ToolbarButton, ToolbarSeparator } from "@ui-sdk/react/toolbar";
import { cn } from "@/renderer/lib/utils";
import { SizeMenu } from "./SizeMenu";
import type { FrameSize } from "./frame-size";
import type { ComponentType } from "react";

const spring = { type: "spring" as const, stiffness: 800, damping: 40, mass: 0.4 };
const springGentle = { type: "spring" as const, stiffness: 700, damping: 35, mass: 0.35 };

// A button in the toolbar's (@ui-sdk) Toolbar, which arrow keys move between.
const IconBtn = ({
  icon,
  label,
  ariaLabel,
  danger,
  accent,
  onClick,
  size = 28,
}: {
  icon: React.ReactNode;
  label?: string;
  // For a button without a label.
  ariaLabel?: string;
  danger?: boolean;
  accent?: boolean;
  onClick?: () => void;
  size?: number;
}) => (
  <ToolbarButton
    onClick={onClick}
    aria-label={ariaLabel}
    className={cn(
      "flex items-center justify-center gap-[5px] border-none bg-transparent cursor-pointer rounded-md text-xs font-medium font-[inherit] transition-all duration-150 ease-[cubic-bezier(0.25,0.1,0.25,1)] active:scale-[0.92] outline-none focus-visible:text-white/80 focus-visible:ring-1 focus-visible:ring-[#E8E8E8]",
      label && "w-auto px-2",
      danger && "text-white/50 hover:text-red-500 hover:bg-red-500/[0.12]",
      accent && "text-white/50 hover:text-indigo-500 hover:bg-indigo-500/15",
      !danger && !accent && "text-white/50 hover:text-white/70 hover:bg-white/[0.06]",
    )}
    style={{ width: label ? undefined : size, height: size }}
  >
    {icon}
    {label && <span>{label}</span>}
  </ToolbarButton>
);

const Divider = ({ className }: { className?: string }) => (
  <ToolbarSeparator className={cn("w-px h-4 bg-white/[0.06] shrink-0", className)} />
);

type PillToggleToolbarProps = {
  componentName: string;
  nodeId: string;
  selected?: boolean;
  onRefresh?: () => void;
  onFullscreen?: () => void;
  // Without it, the Code button is left out.
  onSeeCode?: () => void;
  // The frame's size, for its size menu (SizeMenu). Without it, the menu is
  // left out.
  size?: {
    value: FrameSize;
    onChange: (update: (size: FrameSize) => FrameSize) => void;
    huggedHeight: () => number;
    // Rendered in the menu while it's open (Canvas's sizeMenu).
    Covers?: ComponentType;
  };
};

export const PillToggleToolbar = ({ componentName, nodeId, selected, onRefresh, onFullscreen, onSeeCode, size }: PillToggleToolbarProps) => {
  return (
    <LayoutGroup id={nodeId}>
      <div>
        <div className="relative h-9 z-[1]">
          <div className="absolute top-0 left-0">
            <motion.div
              transition={spring}
              className="flex items-center cursor-pointer overflow-visible origin-left h-9 relative"
              initial={false}
              animate={{
                paddingTop: 5,
                paddingBottom: 5,
                paddingLeft: selected ? 12 : 0,
                paddingRight: 12,
                background: selected ? "#262626" : "rgba(0,0,0,0)",
                borderRadius: selected ? 20 : 9,
              }}
            >
              <motion.div
                className="absolute inset-0 rounded-[inherit] shadow-[0_4px_16px_rgba(0,0,0,0.4),0_0_0_1px_rgba(255,255,255,0.06)] pointer-events-none"
                animate={{ opacity: selected ? 1 : 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              />
              <motion.span
                className="text-xs font-medium font-[inherit] whitespace-nowrap"
                animate={{ color: selected ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.55)" }}
                transition={springGentle}
              >
                {componentName}
              </motion.span>

              <AnimatePresence>
                {selected && (
                  <motion.div
                    initial={{ width: 0, opacity: 0, marginLeft: 0 }}
                    animate={{ width: "auto", opacity: 1, marginLeft: 10 }}
                    exit={{ width: 0, opacity: 0, marginLeft: 0 }}
                    transition={{
                      ...spring,
                      opacity: { type: "spring", stiffness: 800, damping: 30, mass: 0.3 },
                    }}
                    className="overflow-hidden origin-left"
                  >
                    <Toolbar
                      aria-label={`${componentName} frame`}
                      className="flex items-center whitespace-nowrap w-max"
                    >
                      <Divider className="mx-2" />
                      {size && (
                        <>
                          <SizeMenu
                            size={size.value}
                            onSizeChange={size.onChange}
                            huggedHeight={size.huggedHeight}
                            Covers={size.Covers}
                          />
                          <Divider className="mx-1.5" />
                        </>
                      )}
                      {onSeeCode && (
                        <IconBtn icon={<Code size={14} aria-hidden="true" />} label="Code" size={26} onClick={onSeeCode} />
                      )}
                      <IconBtn icon={<RefreshCw size={14} aria-hidden="true" />} ariaLabel="Refresh" size={26} onClick={onRefresh} />
                      <IconBtn icon={<Maximize2 size={14} aria-hidden="true" />} ariaLabel="Full screen" size={26} onClick={onFullscreen} />
                    </Toolbar>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </div>
    </LayoutGroup>
  );
};
