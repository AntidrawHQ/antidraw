import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Dialog } from "radix-ui";
import { Copy, Check, ChevronDown, X } from "lucide-react";
import { File as DiffsFile } from "@pierre/diffs/react";
import { useWorkspaceStore } from "../store/workspace";
import { useComponentSource } from "../store/userComponents";

// --- Copy Dropdown ---

const CopyDropdown = ({
  code,
  fileName,
}: {
  code: string;
  fileName: string;
}) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const doCopy = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(label);
    setOpen(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(null), 1500);
  }, []);

  const prompt = `Implement the following React component exactly as shown. File: ${fileName}\n\n\`\`\`tsx\n${code}\n\`\`\`\n\nCreate this component 1:1, matching the exact structure, props, and logic above.`;

  const items = [
    { label: "Copy Code", action: () => doCopy(code, "Code") },
    { label: "Copy With Prompt", action: () => doCopy(prompt, "Prompt") },
    { label: "Copy Path", action: () => doCopy(fileName, "Path") },
  ];

  const btnStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderRadius: 5,
          border: "1px solid #333",
          overflow: "hidden",
          height: 24,
        }}
      >
        <button
          onClick={items[0].action}
          style={{
            ...btnStyle,
            gap: 4,
            padding: "0 8px",
            color: copied ? "#6366f1" : "#737373",
            fontSize: 11,
            fontWeight: 500,
            transition: "color 0.15s",
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? `Copied ${copied}` : "Copy"}
        </button>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            ...btnStyle,
            padding: "0 4px",
            borderLeft: "1px solid #333",
            color: "#525252",
            height: "100%",
          }}
        >
          <ChevronDown size={10} />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.1 }}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              right: 0,
              background: "#1f1f1f",
              border: "1px solid #333",
              borderRadius: 6,
              padding: 4,
              zIndex: 50,
              minWidth: 160,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                onClick={item.action}
                style={{
                  ...btnStyle,
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: 4,
                  color: "#a3a3a3",
                  fontSize: 11,
                  fontWeight: 450,
                  justifyContent: "flex-start",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#262626";
                  (e.currentTarget as HTMLButtonElement).style.color = "#e5e5e5";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "none";
                  (e.currentTarget as HTMLButtonElement).style.color = "#a3a3a3";
                }}
              >
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- Code Modal ---

export const CodeModal = () => {
  const componentName = useWorkspaceStore((s) => s.codeModalComponentName);
  const setComponentName = useWorkspaceStore((s) => s.setCodeModalComponentName);
  const { data: sourceData } = useComponentSource(componentName);

  const isOpen = componentName !== null;
  const handleClose = useCallback(() => setComponentName(null), [setComponentName]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            {/* Backdrop */}
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0, 0, 0, 0.6)",
                  zIndex: 100,
                }}
              />
            </Dialog.Overlay>

            {/* Modal */}
            <Dialog.Content asChild onOpenAutoFocus={(e) => e.preventDefault()}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{
                  type: "spring",
                  stiffness: 500,
                  damping: 30,
                  mass: 0.5,
                }}
                style={{
                  position: "fixed",
                  inset: 0,
                  margin: "auto",
                  width: "min(640px, 90vw)",
                  height: "min(480px, 80vh)",
                  background: "#181616",
                  borderRadius: 10,
                  border: "1px solid #2a2725",
                  boxShadow: "0 24px 64px rgba(0, 0, 0, 0.5)",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  zIndex: 101,
                }}
              >
                {/* Modal header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    flexShrink: 0,
                  }}
                >
                  <Dialog.Title asChild>
                    <span style={{ fontSize: 12, fontWeight: 500, color: "#a3a3a3" }}>
                      {sourceData?.fileName ?? `${componentName}.tsx`}
                    </span>
                  </Dialog.Title>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {sourceData && (
                      <CopyDropdown
                        code={sourceData.source}
                        fileName={sourceData.fileName}
                      />
                    )}
                    <Dialog.Close asChild>
                      <button
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#525252",
                          cursor: "pointer",
                          padding: 4,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 4,
                        }}
                      >
                        <X size={14} />
                      </button>
                    </Dialog.Close>
                  </div>
                </div>

                {/* Code body */}
                <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                  {sourceData ? (
                    <DiffsFile
                      key={componentName}
                      file={{
                        name: sourceData.fileName,
                        contents: sourceData.source,
                      }}
                      options={{
                        theme: "kanagawa-dragon",
                        overflow: "scroll",
                        disableFileHeader: true,
                        // unsafeCSS: `:host { height: 100%; overflow: hidden; } pre { height: 100%; overflow: auto; } [data-code] { min-height: 100%; align-content: start; --diffs-gap-style: none; } [data-gutter] { padding-right: 8px; }`,
                      }}
                      style={{ height: "100%", overflow: "auto" }}
                    />
                  ) : null}
                </div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
