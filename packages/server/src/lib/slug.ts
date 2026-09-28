import slugify from "@sindresorhus/slugify";
import { generateRandomString } from "better-auth/crypto";

// A site's slug is one DNS label under the sites domain: <slug>.antidraw.app.

// Names a site can't have: hosts we may need, and ones that would read as the
// product's own pages (a phishing page at login.antidraw.app).
const RESERVED = new Set([
  "abuse", "account", "accounts", "admin", "antidraw", "api", "app", "assets",
  "auth", "billing", "blog", "cdn", "dashboard", "dev", "docs", "email", "ftp",
  "help", "internal", "login", "mail", "mx", "ns1", "ns2", "preview", "root",
  "security", "signin", "signup", "smtp", "staging", "static", "status",
  "support", "test", "www",
]);

const MAX_LABEL = 63;
const SUFFIX_LENGTH = 6;
// Room for "-" and the suffix, so a suffixed slug still fits in a label.
const MAX_BASE = MAX_LABEL - SUFFIX_LENGTH - 1;

// Lowercase letters, digits and inner hyphens. DNS reserves "--" in the third
// and fourth places for encodings (punycode's "xn--"); slugify never makes
// that, but the check is cheap.
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const isUsableSlug = (slug: string) =>
  LABEL_RE.test(slug) && slug.slice(2, 4) !== "--" && !RESERVED.has(slug);

/**
 * Slugs to try for a title, in order: the title's own slug, then that with a
 * random suffix ("my-canvas-k3x9qa"), or the suffix alone when the title has
 * nothing slugify can spell (emoji, or a script it can't transliterate).
 */
export function* slugCandidates(title: string, attempts = 5): Generator<string> {
  const base = slugify(title).slice(0, MAX_BASE).replace(/-+$/, "");
  if (isUsableSlug(base)) yield base;
  for (let i = 0; i < attempts; i++) {
    const suffix = generateRandomString(SUFFIX_LENGTH, "a-z", "0-9");
    const slug = base ? `${base}-${suffix}` : suffix;
    if (isUsableSlug(slug)) yield slug;
  }
}
