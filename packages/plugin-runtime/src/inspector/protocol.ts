// The messages between a canvas and the inspector in each preview frame.
//
// The frames are another origin, so the canvas can't reach into them. It
// keeps the pointer and the keyboard, and asks the frame questions ("what is
// at 120, 48?"); the frame answers with what it finds there. Nothing in the
// frame runs until the canvas asks, so a canvas that never does (the
// published share page) is unaffected.

export const INSPECTOR_NS = "antidraw-inspector"
export const INSPECTOR_PROTOCOL = 2

// Set on each element by the runtime's Vite plugin while the dev server
// compiles it: "src/components/user-components/Card.tsx:12:5".
export const SOURCE_ATTRIBUTE = "data-ad-loc"
// Set on each component in that JSX (<Button>), where it's used. A prop like
// any other, it reaches the DOM where the component passes its props on.
export const USE_ATTRIBUTE = "data-ad-use"

export type Sides = [top: number, right: number, bottom: number, left: number]

// How the canvas names an element it can't hold: its source location, which
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
// ones like it: its markup, which carries where it's written and used (the
// stamps above), and what the markup can't say. The canvas knows which
// component's frame it's from.
export type ElementContext = {
  // The frame's size.
  viewport: [width: number, height: number]
  // Its tag, id and first classes: "button#buy.btn.primary".
  element: string
  // Its markup as rendered now, cut short: children a few levels down, long
  // text and values clipped, an <svg>'s drawing left out. One element or
  // text per line, nested two spaces.
  html: string
  // Without a location of its own (a library rendered it), the opening tag
  // of the nearest element around it that has one.
  within: string | null
  // One of several rendered from the same place and used from the same
  // place (a .map()): which.
  repeat: { index: number; count: number } | null
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
