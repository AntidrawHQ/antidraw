import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { Code, RefreshCw, Maximize2 } from "lucide-react";
import { cn } from "@/renderer/lib/utils";
import { useWorkspaceStore } from "../store/workspace";

const spring = { type: "spring" as const, stiffness: 800, damping: 40, mass: 0.4 };
const springGentle = { type: "spring" as const, stiffness: 700, damping: 35, mass: 0.35 };

const IconBtn = ({
  icon,
  label,
  danger,
  accent,
  onClick,
  size = 28,
}: {
  icon: React.ReactNode;
  label?: string;
  danger?: boolean;
  accent?: boolean;
  onClick?: () => void;
  size?: number;
}) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center justify-center gap-[5px] border-none bg-transparent cursor-pointer rounded-md text-xs font-medium font-[inherit] transition-all duration-150 ease-[cubic-bezier(0.25,0.1,0.25,1)] active:scale-[0.92]",
      label && "w-auto px-2",
      danger && "text-white/50 hover:text-red-500 hover:bg-red-500/[0.12]",
      accent && "text-white/50 hover:text-indigo-500 hover:bg-indigo-500/15",
      !danger && !accent && "text-white/50 hover:text-white/70 hover:bg-white/[0.06]",
    )}
    style={{ width: label ? undefined : size, height: size }}
  >
    {icon}
    {label && <span>{label}</span>}
  </button>
);

const Divider = ({ className }: { className?: string }) => (
  <div className={cn("w-px h-4 bg-white/[0.06] shrink-0", className)} />
);

type PillToggleToolbarProps = {
  componentName: string;
  nodeId: string;
  selected?: boolean;
  onRefresh?: () => void;
};

export const PillToggleToolbar = ({ componentName, nodeId, selected, onRefresh }: PillToggleToolbarProps) => {
  const setCodePanelComponentName = useWorkspaceStore((s) => s.setCodePanelComponentName);

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
                animate={{ color: selected ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)" }}
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
                    <div className="flex items-center whitespace-nowrap w-max">
                      <Divider className="mx-2" />
                      <IconBtn icon={<Code size={14} />} label="See Code" size={26} onClick={() => setCodePanelComponentName(componentName)} />
                      <Divider className="mx-1.5" />
                      <IconBtn icon={<RefreshCw size={14} />} size={26} onClick={onRefresh} />
                      <IconBtn icon={<Maximize2 size={14} />} size={26} />
                    </div>
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
