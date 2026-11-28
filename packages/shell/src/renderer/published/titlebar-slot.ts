import { create } from "zustand";

// Where on the window's titlebar a published site's controls go: its right,
// where a workspace has Publish. The titlebar holds the place; the viewer
// fills it (a portal), so what they show (Copied, a fork under way) stays the
// viewer's, beside the canvas the fork's card is drawn on.
export const useTitlebarSlot = create<{ el: HTMLElement | null }>(() => ({ el: null }));

export const setTitlebarSlot = (el: HTMLElement | null) => {
  if (useTitlebarSlot.getState().el !== el) useTitlebarSlot.setState({ el });
};
