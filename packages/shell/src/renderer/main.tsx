import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import "./index.css";
import { router, queryClient } from "./router";
import { claudeCodeAuthQueryOptions } from "./lib/auth";
import { Titlebar } from "./components/ui/titlebar";

const AppShell = () => {
  const { data: claudeCodeAuth, isLoading } = useQuery(
    claudeCodeAuthQueryOptions,
  );

  if (isLoading || !claudeCodeAuth) {
    return (
      <div className="flex h-screen w-full flex-col">
        <Titlebar />
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
