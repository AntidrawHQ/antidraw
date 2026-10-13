// The messages between the shell and its agent in each preview frame
// (agent.ts), which main puts there (main/frame-agent.ts).
//
// The frames are another origin, so the shell can't reach into them. While
// one of its tools is on (Inspect, Comment), the frame takes the pointer:
// it finds the element under it and draws it there, in the page, at the
// page's pace, and tells the shell what a click picked. The shell keeps what
// the picks are for (tags, comments) and asks after them. Both ship in the
// app, so there are no versions between them. Only the attributes are the
// workspace's: its dev server stamps them (@antidrawapp/runtime).

// Not the runtime's own inspector's ("antidraw-inspector", before 0.7), which
// an older workspace still runs: it stays out of this.
export const AGENT_NS = "antidraw-agent"

// Set on each element by the runtime's Vite plugin while the dev server
// compiles it: "src/components/user-components/Card.tsx:12:5".
export const SOURCE_ATTRIBUTE = "data-ad-loc"
// On the element the runtime's preview page renders the component into
// (0.7 on). Before it, the page's root stands in.
export const PREVIEW_ATTRIBUTE = "data-ad-preview"

export type Sides = [top: number, right: number, bottom: number, left: number]

// How the shell names an element it can't hold: its source location, which
// of the elements rendered from that location it is (a .map() repeats one),
// and its child-index path from the component's root with its tag name, for
// when the location is gone (a remount at a new line) or never was. Its text
// settles which one when the location and the path disagree.
export type ElementRef = {
  loc: string | null
  index: number
  path: number[]
  tag: string
  text?: string
}

// In the frame's own CSS pixels, from its top left.
export type Rect = { x: number; y: number; width: number; height: number }

export type ElementInfo = {
  ref: ElementRef
  // The nearest source location (this element's or an ancestor's) in the
  // component the frame previews. For an element rendered by a shared
  // component (ui/button.tsx), where it was used.
  callsite: string | null
  tag: string
  id: string
  classes: string[]
  text: string
  rect: Rect
  margin: Sides
  border: Sides
  padding: Sides
}

// What an agent needs to find one element in the code and tell it from the
// ones like it: its markup, which carries where it's written (the stamps
// above), and what the markup can't say. The shell knows which component's
// frame it's from.
export type ElementContext = {
  // The frame's size.
  viewport: [width: number, height: number]
  // Its tag, id and first classes: "button#buy.btn.primary".
  element: string
  // Its markup as rendered now, cut short: children a few levels down, long
  // text and values clipped, an <svg>'s drawing left out. One element or
  // text per line, nested two spaces.
  html: string
  // Its visible text, clipped: the markup's can be cut off.
  text: string
  // Without a location of its own (a library rendered it), the opening tag
  // of the nearest element around it that has one.
  within: string | null
  // From where it's written (its location, or within's) out to the
  // previewed component: the location in each file on the way, the last in
  // the previewed component's file, where it's used (or the component
  // holding it is). Each with which of the elements written there it is,
  // inside the next one out (the last, in the whole component). Empty when
  // it's written in the previewed component.
  path: { loc: string; index: number; count: number }[]
  // Written in the previewed component and one of several rendered from
  // there (a .map()): which, counted inside the nearest item of a list
  // around it, then that item, out to the outermost list.
  repeat: { loc: string; index: number; count: number }[]
  // No location of its own: which of the elements of its kind its parent
  // holds.
  sibling: { index: number; count: number } | null
  size: [width: number, height: number]
  margin: Sides
  border: Sides
  padding: Sides
}

export type WalkDirection = "parent" | "child" | "next" | "prev"

export type Tool = "inspect" | "comment"

// What a wheel over the frame does while a tool is on: goes to the shell,
// whose canvas pans and zooms with it, or scrolls the frame (its own window).
export type WheelMode = "pass" | "scroll"

// Shell to frame. Each has an id; those answered are answered with it.
export type ToFrame =
  | { type: "hello"; id: number }
  // The tool on, or none: the frame then leaves the pointer to the page. The
  // zoom is the canvas's, for lines a screen pixel or two wide at any zoom.
  | { type: "tool"; id: number; tool: Tool | null; wheel: WheelMode; zoom: number }
  | { type: "select"; id: number; ref: ElementRef | null }
  | { type: "walk"; id: number; dir: WalkDirection }
  // The element an open comment box is on, outlined while the Comment tool
  // is on, or none.
  | { type: "mark"; id: number; ref: ElementRef | null }
  | { type: "context"; id: number; refs: ElementRef[] }
  // Where these elements are, now and as they move (a comment's pin on its
  // element): answered at once, then again whenever one moves, resizes,
  // scrolls, appears or goes. A "track" replaces the last; an empty one stops.
  | { type: "track"; id: number; refs: ElementRef[] }
  // The pointer is elsewhere: what it hovered isn't any more. A frame isn't
  // always told when the pointer leaves it (fast, or into the next frame).
  | { type: "leave"; id: number }

// Frame to shell. "ready" is sent on start and in answer to "hello"; it's
// `provisional` on the page's root standing in for the component's element
// (not there yet, or a runtime without the marker), where the selection
// may not be found yet.
// "selection-changed" and "selection-lost" whenever a re-render (an edit, a
// reload) moves or removes the selected element.
export type FromFrame =
  | { type: "ready"; id?: number; componentName: string; tagged: boolean; provisional?: true }
  // In answer to "select" or "walk", with the id; a click with Inspect,
  // without.
  | { type: "selected"; id?: number; info: ElementInfo | null }
  // A click with the Comment tool: where, and on what.
  | { type: "comment-at"; x: number; y: number; info: ElementInfo | null }
  | { type: "context"; id: number; contexts: (ElementContext | null)[] }
  // The tracked elements' boxes, in "track"'s order: null for one not found.
  // With the id in answer to "track"; without, when one has moved.
  | { type: "tracked"; id?: number; rects: (Rect | null)[] }
  | { type: "selection-changed"; info: ElementInfo }
  | { type: "selection-lost" }
  // The page is going (a reload): until the next one's agent is ready, it
  // can't pick.
  | { type: "gone" }
  // The pointer has come in, with a tool on: the shell has it leave the
  // frame it was in before.
  | { type: "hovering" }
  // While a tool is on, the frame has the pointer, and the keys if it had
  // focus. They're the shell's: the wheel (with "pass") at a point in the
  // frame, and each key pressed and let go (not those with Cmd, Ctrl or Alt).
  | {
      type: "wheel"
      x: number
      y: number
      deltaX: number
      deltaY: number
      deltaMode: number
      ctrlKey: boolean
      metaKey: boolean
      shiftKey: boolean
      altKey: boolean
    }
  | {
      type: "key"
      kind: "down" | "up"
      key: string
      code: string
      ctrlKey: boolean
      metaKey: boolean
      shiftKey: boolean
      altKey: boolean
      repeat: boolean
    }

export type Envelope<T> = T & { ns: typeof AGENT_NS }
