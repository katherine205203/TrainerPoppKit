export const OWNER_COOKIE = "pp_owner";
const OWNER_SESSION_SECONDS = 60 * 60 * 8;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signature(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function constantTimeEqual(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export async function passwordMatches(expected: string, submitted: string): Promise<boolean> {
  const [expectedHash, submittedHash] = await Promise.all([sha256(expected), sha256(submitted)]);
  return constantTimeEqual(expectedHash, submittedHash);
}

export async function createOwnerCookie(secret: string, now = Date.now()): Promise<string> {
  const expires = Math.floor(now / 1000) + OWNER_SESSION_SECONDS;
  const signatureValue = await signature(secret, `owner:${expires}`);
  return `${expires}.${signatureValue}`;
}

export async function isValidOwnerCookie(value: string | null, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!value || !secret) return false;
  const separator = value.indexOf(".");
  if (separator < 1) return false;
  const expires = Number(value.slice(0, separator));
  const providedSignature = value.slice(separator + 1);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(now / 1000)) return false;
  const expectedSignature = await signature(secret, `owner:${expires}`);
  return constantTimeEqual(expectedSignature, providedSignature);
}

export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const cookie of header.split(";")) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

export function ownerCookieHeader(value: string, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${OWNER_COOKIE}=${value}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${OWNER_SESSION_SECONDS}${secure}`;
}

export function clearOwnerCookie(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${OWNER_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure}`;
}

export function bearerToken(request: Request): string | null {
  const value = request.headers.get("Authorization");
  return value?.startsWith("Bearer ") ? value.slice(7) : null;
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}
