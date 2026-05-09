import * as React from "react";

import { cn } from "@/renderer/lib/utils";
import { Input } from "@/renderer/components/ui/input";

export const ThemedInput = ({
  className,
  ...props
}: React.ComponentProps<typeof Input>) => (
  <Input
    className={cn(
      "h-10 rounded-lg border-white/[0.10] bg-transparent px-3 text-[13px] text-[#e0e0e0] placeholder:text-neutral-500",
      className,
    )}
    {...props}
  />
);
