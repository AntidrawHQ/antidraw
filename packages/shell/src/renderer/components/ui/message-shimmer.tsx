import { Message } from "@/renderer/components/ui/message";

export const MessageShimmer = () => (
  <Message className="justify-start">
    <>
      <style>{`
        @keyframes shimmer-text {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        .shimmer-text {
          background: linear-gradient(
            90deg,
            rgba(255,255,255,0.35) 0%,
            rgba(255,255,255,0.35) 40%,
            rgba(255,255,255,1) 50%,
            rgba(255,255,255,0.35) 60%,
            rgba(255,255,255,0.35) 100%
          );
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer-text 2.2s linear infinite;
        }
      `}</style>
      <span className="shimmer-text text-sm font-medium tracking-tight inline-block py-2">
        Working…
      </span>
    </>
  </Message>
);
