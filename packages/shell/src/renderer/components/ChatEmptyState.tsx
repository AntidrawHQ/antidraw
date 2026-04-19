import { cn } from "@/renderer/lib/utils";

export const ChatEmptyState = ({ className }: { className?: string }) => {
  return (
    <div className={cn("flex flex-col items-start", className)}>
      <h1 className="text-sm font-medium text-[#b0b0b0] tracking-[-0.02em]">
        Chat to create designs.
      </h1>
      <p className="text-xs text-[#787878] mt-1.5 leading-normal text-left max-w-[280px]">
        Describe a component, screen, or interaction. Ask for multiple
        versions to see different directions.
      </p>
    </div>
  );
};
