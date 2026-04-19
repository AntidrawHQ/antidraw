import { cn } from "@/renderer/lib/utils";
import { DesignFramesH } from "./DesignFramesH";

export const EmptyState = ({ className }: { className?: string }) => {
  return (
    <div className={cn("flex flex-col items-center gap-6", className)}>
      <DesignFramesH />
      <div className="flex flex-col items-center">
        <h1 className="text-sm font-medium text-[#b0b0b0] tracking-[-0.02em]">
          No components yet
        </h1>
        <p className="text-xs text-[#787878] mt-1.5 leading-normal text-center max-w-[280px]">
          Describe what you want to build and we'll generate the component for
          you.
        </p>
      </div>
    </div>
  );
};
