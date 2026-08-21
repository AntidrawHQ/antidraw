type ClaudeIconProps = {
  size?: number;
} & React.SVGProps<SVGSVGElement>;

/**
 * Claude "sunburst" brand mark. lucide-react has no Claude/Anthropic glyph, so
 * this is a hand-authored recreation: radial spokes of alternating length
 * emanating from a shared center. Renders in `currentColor` (set the color via
 * className/text-*), so it inherits like any icon.
 */
export default function ClaudeIcon({
  size = 16,
  className,
  ...props
}: ClaudeIconProps) {
  // 12 spokes at 30° steps; long/short alternating for the organic burst.
  const CENTER = 12;
  const spokes = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 * Math.PI) / 180;
    const radius = i % 2 === 0 ? 9 : 6.5;
    return {
      x2: CENTER + radius * Math.cos(angle),
      y2: CENTER + radius * Math.sin(angle),
    };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {spokes.map((s, i) => (
        <line key={i} x1={CENTER} y1={CENTER} x2={s.x2} y2={s.y2} />
      ))}
    </svg>
  );
}
