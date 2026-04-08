import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import "./index.css";
import { router, queryClient } from "./router";
import { claudeCodeAuthQueryOptions } from "./lib/auth";

const AppShell = () => {
  const { data: claudeCodeAuth, isLoading } = useQuery(
    claudeCodeAuthQueryOptions,
  );

  if (isLoading || !claudeCodeAuth) {
    return (
      <div className="flex h-screen w-full flex-col">
        <div
          className="h-[38px] w-full shrink-0 bg-neutral-800 border-b border-[#2d2d2d]"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
        <div className="flex-1" />
      </div>
    );
  }

  return (
    <RouterProvider
      router={router}
      context={{ queryClient, claudeCodeAuth }}
    />
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  </StrictMode>,
);
