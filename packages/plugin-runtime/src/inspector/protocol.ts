// The messages between a canvas and the inspector in each preview frame.
//
// The frames are another origin, so the canvas can't reach into them. It
// keeps the pointer and the keyboard, and asks the frame questions ("what is
// at 120, 48?"); the frame answers with what it finds there. Nothing in the
// frame runs until the canvas asks, so a canvas that never does (the
// published share page) is unaffected.

export const INSPECTOR_NS = "antidraw-inspector"
export const INSPECTOR_PROTOCOL = 1

// Set on each element by the runtime's Vite plugin while the dev server
// compiles it: "src/components/user-components/Card.tsx:12:5".
export const SOURCE_ATTRIBUTE = "data-ad-loc"

export type Sides = [top: number, right: number, bottom: number, left: number]

// How the canvas names an element it can't hold: its source location, which
// of the elements rendered from that location it is (a .map() repeats one),
// and its child-index path from the component's root with its tag name, for
// when the location is gone (a remount at a new line) or never was.
export type ElementRef = {
  loc: string | null
  index: number
  path: number[]
  tag: string
}

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
  // In the frame's own CSS pixels, from its top left.
  rect: { x: number; y: number; width: number; height: number }
  margin: Sides
  border: Sides
  padding: Sides
}

// What an agent needs to find one element in the code and tell it from the
// ones like it, beyond what it can read there itself (no computed styles).
// The canvas knows which component's frame it's from.
export type ElementContext = {
  // The frame's size.
  viewport: [width: number, height: number]
  // Its tag, id and first classes: "button#buy.btn.primary".
  element: string
  text: string
  // Where it's written. Without one (a library rendered it), the nearest
  // element around it that has one, and the way down from there.
  loc: string | null
  within: { loc: string; path: string } | null
  // The components whose code rendered it, from the previewed one in, each
  // with the nearest place in its code around it (the element's own location
  // for the innermost). Library components without one are left out.
  components: { name: string; loc: string | null }[]
  // One of several rendered from the same place, by way of the same places
  // in the components around it (a .map()): which, and the React keys on and
  // around it, outermost first.
  repeat: { index: number; count: number; keys: string[] } | null
  // The attributes that say what it is or what state it's in.
  attributes: Record<string, string>
  size: [width: number, height: number]
  margin: Sides
  border: Sides
  padding: Sides
}

export type WalkDirection = "parent" | "child" | "next" | "prev"

// Canvas to frame. Each carries an id the answer repeats.
export type ToFrame =
  | { type: "hello"; id: number }
  | { type: "hit"; id: number; x: number; y: number }
  | { type: "select-at"; id: number; x: number; y: number }
  | { type: "select"; id: number; ref: ElementRef | null }
  | { type: "walk"; id: number; dir: WalkDirection }
  | { type: "context"; id: number; refs: ElementRef[] }

// Frame to canvas. "ready" is sent on start and in answer to "hello";
// "selection-changed" and "selection-lost" whenever a re-render (an edit, a
// hot reload) moves, resizes, re-tags or removes the selected element.
export type FromFrame =
  | { type: "ready"; id?: number; protocol: number; componentName: string; tagged: boolean }
  | { type: "hover"; id: number; info: ElementInfo | null }
  | { type: "selected"; id: number; info: ElementInfo | null }
  | { type: "context"; id: number; contexts: (ElementContext | null)[] }
  | { type: "selection-changed"; info: ElementInfo }
  | { type: "selection-lost" }

export type Envelope<T> = T & { ns: typeof INSPECTOR_NS }
