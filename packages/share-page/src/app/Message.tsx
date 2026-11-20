export const Message = ({ text }: { text: string }) => (
  // The canvas's surface (Canvas.tsx), which has no dots since #132.
  <div className="flex h-dvh items-center justify-center bg-[#282828]">
    <div className="text-sm text-neutral-500">{text}</div>
  </div>
);
