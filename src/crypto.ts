/** HMAC-SHA256 helpers (Web Crypto) for the bucket0.com <-> Worker trust bridge. */

const enc = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function hmacSign(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish compare of two equal-length hex strings. */
export async function hmacVerify(secret: string, message: string, hex: string): Promise<boolean> {
  const expected = await hmacSign(secret, message);
  if (expected.length !== hex.length) return false;
  let result = 0;
  for (let i = 0; i < expected.length; i++) result |= expected.charCodeAt(i) ^ hex.charCodeAt(i);
  return result === 0;
}

export const b64urlEncode = (s: string): string =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const b64urlDecode = (s: string): string => {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = t.length % 4 === 0 ? "" : "=".repeat(4 - (t.length % 4));
  return atob(t + pad);
};

const toBytes = (binary: string): Uint8Array => Uint8Array.from(binary, (c) => c.charCodeAt(0));

async function aesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret)); // 32-byte key
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["decrypt"]);
}

/**
 * Decrypt the one-time code minted by bucket0.com. Format: b64url(iv).b64url(ct||tag),
 * AES-256-GCM, key = SHA-256(secret). Returns the plaintext JSON ({ userId, apiKey, exp }).
 */
export async function decryptCode(secret: string, code: string): Promise<string> {
  const [ivPart, blobPart] = code.split(".");
  if (!ivPart || !blobPart) throw new Error("malformed code");
  const iv = toBytes(b64urlDecode(ivPart));
  const blob = toBytes(b64urlDecode(blobPart));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    await aesKey(secret),
    blob
  );
  return new TextDecoder().decode(plaintext);
}
