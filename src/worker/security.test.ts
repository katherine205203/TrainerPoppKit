// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bearerToken, createOwnerCookie, isValidOwnerCookie, ownerCookieHeader, passwordMatches } from "./security";

describe("owner and guest capability helpers", () => {
  it("signs owner sessions, expires them, and rejects tampering", async () => {
    const secret = "test-session-secret-that-is-long-enough-for-hmac";
    const cookie = await createOwnerCookie(secret, 1_800_000_000_000);
    expect(await isValidOwnerCookie(cookie, secret, 1_800_000_001_000)).toBe(true);
    expect(await isValidOwnerCookie(cookie, "a-different-session-secret-that-is-long-enough", 1_800_000_001_000)).toBe(false);
    expect(await isValidOwnerCookie(`${cookie}x`, secret, 1_800_000_001_000)).toBe(false);
    expect(await isValidOwnerCookie(cookie, secret, 1_900_000_000_000)).toBe(false);
  });

  it("uses HTTP-only and strict same-site owner cookies", async () => {
    const cookie = await createOwnerCookie("long-enough-session-signing-secret-for-a-test");
    expect(ownerCookieHeader(cookie, "https://example.workers.dev")).toContain("HttpOnly");
    expect(ownerCookieHeader(cookie, "https://example.workers.dev")).toContain("SameSite=Strict");
    expect(ownerCookieHeader(cookie, "https://example.workers.dev")).toContain("Secure");
  });

  it("compares the owner password and reads only explicit bearer tokens", async () => {
    expect(await passwordMatches("correct-horse", "correct-horse")).toBe(true);
    expect(await passwordMatches("correct-horse", "incorrect")).toBe(false);
    expect(bearerToken(new Request("https://example.test", { headers: { Authorization: "Bearer scoped-token" } }))).toBe("scoped-token");
    expect(bearerToken(new Request("https://example.test", { headers: { Authorization: "Basic dGVzdA==" } }))).toBeNull();
  });
});
