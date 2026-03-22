import type { ReactNode } from "react";
import { cn } from "@/renderer/lib/utils";

export const renderHighlighted = (text: string, indices: number[]): ReactNode => {
  if (!indices.length) return text;
  const indexSet = new Set(indices);
  return text.split("").map((char, i) => (
    <span key={i} className={cn(indexSet.has(i) && "text-white font-semibold")}>
      {char}
    </span>
  ));
};
