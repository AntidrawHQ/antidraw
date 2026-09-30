// Where a published site's files are, for the app and the Worker alike.
// `pattern` is a site's base URL with * for its slug: https://*.antidraw.app.

// /s/<slug>, with or without a trailing slash. A slug is one DNS label (see
// the server's slug rules); anything else names no canvas.
const PATH_RE = /^\/s\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\/?$/;

export const slugFromPath = (pathname: string): string | null => PATH_RE.exec(pathname)?.[1] ?? null;

export const siteFor = (pattern: string, slug: string) => {
  const base = new URL(`${pattern.replace("*", slug)}/`);
  return {
    canvasFile: new URL("canvas.json", base).href,
    // The Preview page of the workspace's build (@antidrawapp/runtime).
    frameUrl: (componentName: string) =>
      new URL(`preview?componentName=${encodeURIComponent(componentName)}`, base).href,
  };
};
