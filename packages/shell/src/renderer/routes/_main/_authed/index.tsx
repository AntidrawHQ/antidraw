import { createFileRoute } from "@tanstack/react-router";
import App from "@/renderer/App";

export const Route = createFileRoute("/_main/_authed/")({
  component: App,
});
