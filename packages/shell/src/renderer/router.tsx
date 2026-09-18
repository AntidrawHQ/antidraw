import { createRouter, createHashHistory } from "@tanstack/react-router";
import { QueryClient } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";

const hashHistory = createHashHistory();

// Every request here goes to the local main process over antidraw://, so the
// browser's idea of "online" says nothing about whether it can be served. The
// default networkMode ("online") pauses queries and mutations after an
// `offline` event — a Wi-Fi blip, a wake from sleep — and a paused query is
// pending without fetching: no request, no error, isLoading false. The chat
// rendered that as an empty conversation.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});

export const router = createRouter({
  routeTree,
  history: hashHistory,
  context: {
    queryClient,
  },
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
