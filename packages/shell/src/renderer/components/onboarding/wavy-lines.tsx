export const WavyVerticalLine = () => (
  <svg
    className="absolute pointer-events-none overflow-visible"
    style={{ left: -60, top: -40, width: 60, height: "calc(100% + 80px)" }}
    viewBox="0 0 60 100"
    preserveAspectRatio="none"
    fill="none"
  >
    <path
      d="M 38 0 C 35 15, 42 35, 38 50 S 34 70, 38 85 S 42 95, 38 100"
      stroke="rgba(255,255,255,0.08)"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);

export const WavyHorizontalLine = () => (
  <svg
    className="pointer-events-none my-2"
    style={{ marginLeft: -160, width: "calc(100% + 190px)" }}
    height="20"
    viewBox="0 0 570 20"
    preserveAspectRatio="none"
    fill="none"
  >
    <path
      d="M 0 12 C 40 9, 80 14, 140 10 S 240 7, 340 12 S 480 6, 570 11"
      stroke="rgba(255,255,255,0.08)"
      strokeWidth="2"
      strokeLinecap="round"
      fill="none"
    />
  </svg>
);
