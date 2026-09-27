// Site slugs: one DNS label each, the <slug> in <slug>.antidraw.app. Assigned
// at a workspace's first publish and never changed afterwards.

// The same regex as packages/publish-worker.
export const PUBLISH_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// Names a site must never take: first-party hosts, and words that would read
// as the product's own pages on the shared domain.
// prettier-ignore
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "www", "api", "app", "admin", "source", "sources", "static", "assets", "mail", "email",
  "smtp", "imap", "pop", "ftp", "cdn", "docs", "help", "support", "status", "blog",
  "dashboard", "auth", "login", "signin", "signup", "account", "accounts", "billing", "dev",
  "staging", "test", "beta", "preview", "default-canvas", "antidraw", "remix", "publish",
  "sites", "site", "files", "download", "downloads", "internal", "root", "mx", "ns1", "ns2",
  "webmail", "autodiscover", "localhost",
]);

const MAX_BASE_LENGTH = 40;
const FALLBACK_BASE = "canvas";

const trimDashes = (s: string) => s.replace(/^-+|-+$/g, "");

// The readable part: NFKD with combining marks dropped ("Café" -> "cafe"),
// lowercased, every run of anything else collapsed to "-", cut to 40 chars.
export const slugBase = (name: string): string => {
  const base = trimDashes(
    trimDashes(
      name
        .normalize("NFKD")
        .replace(/\p{M}+/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
    ).slice(0, MAX_BASE_LENGTH),
  );
  return base === "" || RESERVED_SLUGS.has(base) ? FALLBACK_BASE : base;
};

// No 0/o, 1/l/i: the suffix gets read aloud and typed.
const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SUFFIX_LENGTH = 5;
// The largest multiple of the alphabet size a byte can hold; bytes at or
// above it are redrawn so every character is equally likely.
const SUFFIX_BYTE_LIMIT = 256 - (256 % SUFFIX_ALPHABET.length);

export const randomSuffix = (): string => {
  let out = "";
  const bytes = new Uint8Array(16);
  while (out.length < SUFFIX_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= SUFFIX_BYTE_LIMIT) continue;
      out += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length];
      if (out.length === SUFFIX_LENGTH) break;
    }
  }
  return out;
};

export const makeSlug = (name: string, suffix: () => string = randomSuffix): string =>
  `${slugBase(name)}-${suffix()}`;

// Punycode labels ("xn--") are refused so a slug cannot pose as a lookalike
// internationalized name.
export const isAllowedSlug = (slug: string): boolean =>
  PUBLISH_ID_RE.test(slug) && !slug.startsWith("xn--") && !RESERVED_SLUGS.has(slug);
