import type { ReactNode } from "react";

// The few icons the list needs, drawn here so the page takes on no icon
// package for them. Lucide's shapes, as the shell uses.

const Icon = ({ size = 16, className, children }: { size?: number; className?: string; children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    {children}
  </svg>
);

type IconProps = { size?: number; className?: string };

export const ChevronLeft = (props: IconProps) => (
  <Icon {...props}>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);

export const ChevronRight = (props: IconProps) => (
  <Icon {...props}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);
