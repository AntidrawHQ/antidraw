import { Message } from "@/renderer/components/ui/message";

export const MessageShimmer = () => (
  <Message className="justify-start">
    <div className="bg-secondary rounded-lg p-2 w-full">
      <div className="flex flex-col gap-2 animate-pulse">
        <div className="h-3 rounded bg-foreground/10 w-3/4" />
        <div className="h-3 rounded bg-foreground/10 w-1/2" />
        <div className="h-3 rounded bg-foreground/10 w-2/3" />
      </div>
    </div>
  </Message>
);
