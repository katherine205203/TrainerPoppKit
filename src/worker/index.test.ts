// @vitest-environment node
import { describe, expect, it } from "vitest";
import { handleRequest } from "./index";

const env = { OWNER_PASSWORD: "owner-password", SESSION_SECRET: "a-session-secret-that-is-at-least-thirty-two-chars" };

describe("Worker authorization boundaries", () => {
  it("fails closed when owner secrets are absent", async () => {
    const response = await handleRequest(new Request("https://trainer.test/api/owner/sessions"), {});
    expect(response.status).toBe(503);
  });

  it("does not allow a public PIN or unauthenticated request into owner APIs", async () => {
    const response = await handleRequest(new Request("https://trainer.test/api/owner/sessions"), env);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Owner sign-in required." });
  });

  it("requires same-origin sign-in and sets a signed owner cookie", async () => {
    const rateLimitDb = {
      prepare: () => ({ bind: () => ({ run: async () => undefined, first: async () => ({ attempts: 1 }) }) }),
    } as unknown as D1Database;
    const configuredEnv = { ...env, DB: rateLimitDb };
    const crossOrigin = await handleRequest(new Request("https://trainer.test/api/auth/login", {
      method: "POST", headers: { Origin: "https://attacker.test", "Content-Type": "application/json" }, body: JSON.stringify({ password: "owner-password" }),
    }), configuredEnv);
    expect(crossOrigin.status).toBe(403);

    const signIn = await handleRequest(new Request("https://trainer.test/api/auth/login", {
      method: "POST", headers: { Origin: "https://trainer.test", "Content-Type": "application/json" }, body: JSON.stringify({ password: "owner-password" }),
    }), configuredEnv);
    expect(signIn.status).toBe(200);
    expect(signIn.headers.get("Set-Cookie")).toContain("HttpOnly");
    const cookie = signIn.headers.get("Set-Cookie")!.split(";")[0]!;
    const check = await handleRequest(new Request("https://trainer.test/api/auth/me", { headers: { Cookie: cookie } }), env);
    expect(await check.json()).toEqual({ authenticated: true });
  });

  it("does not accept a PIN as a presenter or guest capability", async () => {
    const emptyDb = { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as unknown as D1Database;
    const configuredEnv = { ...env, DB: emptyDb };
    const publicPresenter = await handleRequest(new Request("https://trainer.test/api/presenter", { headers: { Authorization: "Bearer 123456" } }), configuredEnv);
    expect(publicPresenter.status).toBe(404);
    const guest = await handleRequest(new Request("https://trainer.test/api/guest/me", { headers: { Authorization: "Bearer 123456" } }), configuredEnv);
    expect(guest.status).toBe(401);
  });
});
