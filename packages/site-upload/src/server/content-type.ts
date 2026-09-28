import mime from "mime";

/** The Content-Type Cloudflare's own static-asset serving would send for `path`. */
export function contentType(path: string): string {
  const type = mime.getType(path);
  if (!type) return "application/octet-stream";
  return type.startsWith("text/") && !type.includes("charset") ? `${type}; charset=utf-8` : type;
}

/**
 * Types a browser can open as a page and run script in: HTML, XHTML, SVG and
 * other XML documents. These are never cached as immutable or retained past a
 * publish, whatever the uploader marks them, so a new publish always replaces them.
 */
export const isDocument = (type: string) =>
  /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/(?:[\w.-]+\+)?xml)\b/.test(type);
