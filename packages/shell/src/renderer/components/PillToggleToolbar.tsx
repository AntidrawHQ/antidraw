import { useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";

// ─── Icons ───────────────────────────────────────────────────────

const icons = {
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  refresh: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  ),
  maximize: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  ),
};

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

const Divider = () => (
  <div style={{ width: 1, height: 16, background: c.borderSubtle, margin: "0 2px", flexShrink: 0 }} />
);

// ─── Pill Toggle Toolbar ─────────────────────────────────────────

type PillToggleToolbarProps = {
  componentName: string;
  nodeId: string;
  selected: boolean;
};

export const PillToggleToolbar = ({ componentName, nodeId, selected }: PillToggleToolbarProps) => {
  const [mode, setMode] = useState<"design" | "code">("design");

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

              {/* Divider + Design/Code toggle + icons — morphs in on select */}
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
                    <Divider />
                    <div style={{
                      display: "flex", alignItems: "center", gap: 1,
                      background: c.bgInset, borderRadius: 16, padding: 2,
                      marginLeft: 4,
                      position: "relative",
                    }}>
                      {(["design", "code"] as const).map((m) => (
                        <button
                          key={m}
                          onClick={(e) => { e.stopPropagation(); setMode(m); }}
                          style={{
                            padding: "4px 12px", fontSize: 11, fontWeight: 500, fontFamily: "inherit",
                            border: "none", borderRadius: 14, cursor: "pointer",
                            background: "transparent",
                            color: mode === m ? c.text : c.textMuted,
                            transition: "color 150ms cubic-bezier(0.25, 0.1, 0.25, 1)",
                            position: "relative",
                            zIndex: 1,
                          }}
                        >
                          {mode === m && (
                            <motion.div
                              layoutId="pill-toggle-indicator"
                              layout="position"
                              layoutDependency={mode}
                              style={{
                                position: "absolute",
                                inset: 0,
                                borderRadius: 14,
                                background: "#2a2a2a",
                                boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                                zIndex: -1,
                              }}
                              transition={spring}
                            />
                          )}
                          {m === "design" ? "Design" : "Code"}
                        </button>
                      ))}
                    </div>
                    <Divider />
                    <IconBtn icon={icons.copy} size={26} />
                    <IconBtn icon={icons.refresh} size={26} />
                    <IconBtn icon={icons.maximize} size={26} />
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
