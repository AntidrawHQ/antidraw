// What the app's inspector reads in a preview page. The inspector is the
// app's: it puts it in each preview frame it shows. The page only marks what
// the inspector looks for, and the dev server stamps each element with where
// it's written.

// Set on each element by the runtime's Vite plugin while the dev server
// compiles it: "src/components/user-components/Card.tsx:12:5".
export const SOURCE_ATTRIBUTE = "data-ad-loc"

// On the element the preview page renders the component into, naming it.
export const PREVIEW_ATTRIBUTE = "data-ad-preview"
