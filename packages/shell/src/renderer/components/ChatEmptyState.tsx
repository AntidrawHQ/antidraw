const c = {
  textPrimary: "#b0b0b0",
  textSecondary: "#787878",
  fontSans:
    '"Geist Sans", "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

export const ChatEmptyState = ({ className }: { className?: string }) => {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        fontFamily: c.fontSans,
        WebkitFontSmoothing: "antialiased",
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
        Chat to create designs.
      </h1>
      <p
        style={{
          fontSize: 12,
          color: c.textSecondary,
          margin: "6px 0 0",
          lineHeight: 1.5,
          textAlign: "left",
          maxWidth: 280,
        }}
      >
        Describe a component, screen, or interaction. Ask for multiple
        versions to see different directions.
      </p>
    </div>
  );
};
