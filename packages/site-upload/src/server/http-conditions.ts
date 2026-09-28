/** Inclusive byte range. */
export type ByteRange = { start: number; end: number };

/**
 * Parses a Range header for a file of `size` bytes (RFC 9110 §14). Returns
 * null when the header should be ignored and the whole file sent: malformed
 * headers, other units, and multiple ranges, which this server doesn't do.
 */
export function parseRange(header: string, size: number): ByteRange | "unsatisfiable" | null {
  const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match) return null;
  const [, first = "", last = ""] = match;
  if (first === "" && last === "") return null;

  if (first === "") {
    const suffix = Number(last);
    if (suffix === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(first);
  if (last !== "" && Number(last) < start) return null;
  if (start >= size) return "unsatisfiable";
  const end = last === "" ? size - 1 : Math.min(Number(last), size - 1);
  return { start, end };
}

/** If-None-Match uses weak comparison, so W/"x" matches "x". */
export function ifNoneMatchHits(header: string | null, etag: string): boolean {
  if (header === null) return false;
  if (header.trim() === "*") return true;
  return header.split(",").some((tag) => {
    const value = tag.trim();
    return (value.startsWith("W/") ? value.slice(2) : value) === etag;
  });
}

/**
 * If-Range needs a strong match. A date or a weak tag never matches, since
 * files here have no Last-Modified, so the full file is sent instead.
 */
export const ifRangeAllows = (header: string | null, etag: string) =>
  header === null || header.trim() === etag;
