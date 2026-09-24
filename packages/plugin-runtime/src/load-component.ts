import type { ComponentType } from "react"

// Loads a user component by name for the Preview page.
//
// This is the dev-server version: the path is built at runtime and fetched
// from the dev server, which transforms whatever file is on disk right now —
// including components written after the page loaded. The import is marked
// @vite-ignore because Vite would otherwise try to turn the template literal
// into a glob of src/components/user-components/, which it cannot do for an
// absolute path (and a glob would fix the list at startup).
//
// A published build has no dev server to fetch from, so the shell's publish
// build replaces this module with a map from each component name to a lazy
// import of its file (componentsForBuild in packages/shell/src/publish/
// vite-plugins.ts). Only the export's signature is shared: keep it in step
// with that map.
export const loadComponent = (
  name: string,
): Promise<{ default: ComponentType }> =>
  import(
    /* @vite-ignore */ `/src/components/user-components/${encodeURIComponent(name)}.tsx`
  )
