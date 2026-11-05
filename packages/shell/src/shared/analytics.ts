// Product analytics, content-free: event names, and properties that are
// counts, enums, ids and durations. Never a prompt, a comment's text, a
// workspace's or component's name, or a file path.

// What a renderer may report (preload's `track`). Main checks each event
// against this list; main's own events need no list.
export const RENDERER_EVENTS = [
  "welcome_viewed",
  "onboarding_started",
  "workspace_switched",
  "frame_code_viewed",
  "frame_copied",
  "frame_opened_in_window",
  "frame_refreshed",
  "canvas_tool_selected",
  "element_tagged",
  "panel_toggled",
  "side_panel_tab_selected",
  "right_panel_tab_selected",
  "comments_sent",
  "design_edits_sent",
  "design_edit_undone",
  "design_edits_reset",
  "publish_clicked",
  "publish_link_copied",
  "update_restart_clicked",
  "update_dismissed",
] as const;

export type RendererEvent = (typeof RENDERER_EVENTS)[number];

export type AnalyticsProperties = Record<string, string | number | boolean | null | string[]>;

export const isRendererEvent = (event: unknown): event is RendererEvent =>
  typeof event === "string" && (RENDERER_EVENTS as readonly string[]).includes(event);

// Flat primitives (and lists of strings) only: anything else from a renderer
// is dropped rather than sent.
export const toAnalyticsProperties = (value: unknown): AnalyticsProperties => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const properties: AnalyticsProperties = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)))
      properties[key] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === "string")) properties[key] = v;
  }
  return properties;
};
