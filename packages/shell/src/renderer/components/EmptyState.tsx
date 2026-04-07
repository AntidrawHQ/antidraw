import { DesignFramesH } from "./DesignFramesH";

const c = {
  textPrimary: "#b0b0b0",
  textSecondary: "#787878",
  fontSans:
    '"Geist Sans", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

export const EmptyState = ({ className }: { className?: string }) => {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        fontFamily: c.fontSans,
        WebkitFontSmoothing: "antialiased",
        gap: 24,
      }}
    >
      <DesignFramesH />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <h1
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: c.textPrimary,
            margin: 0,
            letterSpacing: "-0.02em",
          }}
        >
          No components yet
        </h1>
        <p
          style={{
            fontSize: 12,
            color: c.textSecondary,
            margin: "6px 0 0",
            lineHeight: 1.5,
            textAlign: "center",
            maxWidth: 280,
          }}
        >
          Describe what you want to build and we'll generate the component for
          you.
        </p>
      </div>
    </div>
  );
};
