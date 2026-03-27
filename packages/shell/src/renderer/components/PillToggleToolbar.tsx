import { useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { Code, Copy, RefreshCw, Maximize2 } from "lucide-react";

// ─── Design tokens ───────────────────────────────────────────────

const c = {
  bg: "#1a1a1a",
  bgSurface: "#262626",
  bgInset: "#0d0d0d",
  border: "#2d2d2d",
  borderSubtle: "rgba(255,255,255,0.06)",
  text: "rgba(255,255,255,0.88)",
  textMuted: "rgba(255,255,255,0.5)",
  textDim: "rgba(255,255,255,0.3)",
  accent: "#6366f1",
  accentSubtle: "rgba(99,102,241,0.15)",
  red: "#ef4444",
  redSubtle: "rgba(239,68,68,0.12)",
};

const spring = { type: "spring" as const, stiffness: 800, damping: 40, mass: 0.4 };
const springGentle = { type: "spring" as const, stiffness: 700, damping: 35, mass: 0.35 };

// ─── Primitives ──────────────────────────────────────────────────

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
}) => {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  let color = c.textMuted;
  let bg = "transparent";
  if (danger && hovered) { color = c.red; bg = c.redSubtle; }
  else if (accent && hovered) { color = c.accent; bg = c.accentSubtle; }
  else if (hovered) { color = "rgba(255,255,255,0.7)"; bg = "rgba(255,255,255,0.06)"; }

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        width: label ? "auto" : size, height: size,
        padding: label ? "0 8px" : 0,
        border: "none", background: bg, color, cursor: "pointer",
        borderRadius: 6,
        transition: "all 150ms cubic-bezier(0.25, 0.1, 0.25, 1)",
        transform: pressed ? "scale(0.92)" : "scale(1)",
        fontSize: 12, fontWeight: 500, fontFamily: "inherit",
      }}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
};

const Divider = ({ spacing = 2 }: { spacing?: number }) => (
  <div style={{ width: 1, height: 16, background: c.borderSubtle, margin: `0 ${spacing}px`, flexShrink: 0 }} />
);

// ─── Pill Toggle Toolbar ─────────────────────────────────────────

type PillToggleToolbarProps = {
  componentName: string;
  nodeId: string;
  selected: boolean;
};

export const PillToggleToolbar = ({ componentName, nodeId, selected }: PillToggleToolbarProps) => {

  return (
    <LayoutGroup id={nodeId}>
      <div>
        <div style={{ position: "relative", height: 36, zIndex: 1 }}>
          <div style={{ position: "absolute", top: 0, left: 0 }}>
            <motion.div
              transition={spring}
              style={{
                display: "flex",
                alignItems: "center",
                cursor: "pointer",
                overflow: "visible",
                transformOrigin: "left center",
                height: 36,
                position: "relative",
              }}
              initial={false}
              animate={{
                paddingTop: 5,
                paddingBottom: 5,
                paddingLeft: selected ? 12 : 0,
                paddingRight: 12,
                background: selected ? c.bgSurface : "rgba(0,0,0,0)",
                borderRadius: selected ? 20 : 9,
              }}
            >
              {/* Shadow layer — crossfade via opacity instead of animating boxShadow */}
              <motion.div
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: "inherit",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)",
                  pointerEvents: "none",
                }}
                animate={{ opacity: selected ? 1 : 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              />
              {/* Component name — always visible, left side. Click to toggle. */}
              <motion.span
                style={{ fontSize: 12, fontWeight: 500, fontFamily: "inherit", whiteSpace: "nowrap" }}
                animate={{ color: selected ? c.textMuted : c.textDim }}
                transition={springGentle}
              >
                {componentName}
              </motion.span>

              {/* Divider + action icons — morphs in on select */}
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
                    style={{
                      overflow: "hidden",
                      transformOrigin: "left center",
                    }}
                  >
                    <div style={{
                      display: "flex", alignItems: "center",
                      whiteSpace: "nowrap",
                      width: "max-content",
                    }}>
                    <Divider spacing={8} />
                    <IconBtn icon={<Code size={14} />} label="See Code" size={26} />
                    <Divider spacing={6} />
                    <IconBtn icon={<Copy size={14} />} size={26} />
                    <IconBtn icon={<RefreshCw size={14} />} size={26} />
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
