import { err, ok, type Result } from "neverthrow";
import { z } from "zod";
import { apiError, type ApiError } from "./errors";

// Tokens for the dev storage route (/api/storage/:token, STORAGE_MODE="worker"
// only): the local stand-in for a presigned R2 URL. A token names one object
// and one operation, and carries what the PUT must match:
//
//   base64url(JSON payload) "." base64url(HMAC-SHA256(key, base64url(JSON)))
//
// The key is derived from BETTER_AUTH_SECRET for this one purpose, so a token
// is never interchangeable with anything better-auth signs.

export type BucketName = "sites" | "sources";

const payloadSchema = z.object({
  v: z.literal(1),
  op: z.enum(["put", "get"]),
  b: z.enum(["sites", "sources"]),
  k: z.string().min(1),
  n: z.number().int().nonnegative().optional(), // put: exact size
  h: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(), // put: sha256 hex
  ct: z.string().optional(), // put: content type
  cc: z.string().optional(), // put: cache control
  exp: z.number().int(), // unix ms
});
export type StorageTokenPayload = z.infer<typeof payloadSchema>;

const KEY_LABEL = "antidraw-storage-token-v1";
const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string): Uint8Array | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    return null;
  }
};

const hmacKey = (raw: BufferSource, usage: "sign" | "verify") =>
  crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, [usage]);

const tokenKey = async (secret: string, usage: "sign" | "verify") => {
  const root = await hmacKey(encoder.encode(secret), "sign");
  const derived = await crypto.subtle.sign("HMAC", root, encoder.encode(KEY_LABEL));
  return hmacKey(derived, usage);
};

export const signStorageToken = async (
  secret: string,
  payload: StorageTokenPayload,
): Promise<string> => {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await tokenKey(secret, "sign"),
    encoder.encode(body),
  );
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
};

const invalid = () => apiError(403, "STORAGE_TOKEN_INVALID", "Invalid storage token");

// crypto.subtle.verify compares in constant time.
export const verifyStorageToken = async (
  secret: string,
  token: string,
  now: Date,
): Promise<Result<StorageTokenPayload, ApiError>> => {
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length > 0) return err(invalid());
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes) return err(invalid());
  const valid = await crypto.subtle.verify(
    "HMAC",
    await tokenKey(secret, "verify"),
    signatureBytes,
    encoder.encode(body),
  );
  if (!valid) return err(invalid());

  const bodyBytes = fromBase64Url(body);
  if (!bodyBytes) return err(invalid());
  let parsed: ReturnType<typeof payloadSchema.safeParse>;
  try {
    parsed = payloadSchema.safeParse(JSON.parse(new TextDecoder().decode(bodyBytes)));
  } catch {
    return err(invalid());
  }
  if (!parsed.success) return err(invalid());
  if (parsed.data.exp < now.getTime()) {
    return err(apiError(410, "STORAGE_TOKEN_EXPIRED", "Storage token expired"));
  }
  return ok(parsed.data);
};
