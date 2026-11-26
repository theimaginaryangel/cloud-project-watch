import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getDashboardData } from "@/lib/scans/orchestrator";
import {
  assertAmbientAwsAllowed,
  blockIfPublicDemoLocked,
  enforceApiGuard,
  isOwnerAuthMissingInProduction,
  isPublicDemoLocked,
  isStatelessDemoMode,
  parseJsonBody,
  resetRateLimitsForTests,
  sanitizeErrorMessage,
  verifyCsrfMutationRequest,
  verifyOwnerBasicAuth,
} from "@/lib/security/guards";

function encodeBasicUtf8(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return `Basic ${btoa(binary)}`;
}

describe("Security guards (Auth, CSRF, Rate-Limit, Demo Lock & Error Redaction)", () => {
  const originalLock = process.env.PUBLIC_DEMO_LOCK;
  const originalVercel = process.env.VERCEL;
  const originalDbUrl = process.env.DATABASE_URL;
  const originalOwnerPass = process.env.OWNER_PASSWORD;
  const originalAmbient = process.env.ALLOW_AMBIENT_AWS_CREDENTIALS;

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimitsForTests();

    if (originalLock === undefined) delete process.env.PUBLIC_DEMO_LOCK;
    else process.env.PUBLIC_DEMO_LOCK = originalLock;

    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;

    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;

    if (originalOwnerPass === undefined) delete process.env.OWNER_PASSWORD;
    else process.env.OWNER_PASSWORD = originalOwnerPass;

    if (originalAmbient === undefined) delete process.env.ALLOW_AMBIENT_AWS_CREDENTIALS;
    else process.env.ALLOW_AMBIENT_AWS_CREDENTIALS = originalAmbient;
  });

  it("blocks mutations with 403 when PUBLIC_DEMO_LOCK=true and allows when false", () => {
    delete process.env.VERCEL;
    process.env.PUBLIC_DEMO_LOCK = "true";
    expect(isPublicDemoLocked()).toBe(true);
    expect(isStatelessDemoMode()).toBe(true);
    const blocked = blockIfPublicDemoLocked();
    expect(blocked?.status).toBe(403);

    process.env.PUBLIC_DEMO_LOCK = "false";
    expect(isPublicDemoLocked()).toBe(false);
    expect(blockIfPublicDemoLocked()).toBeNull();
  });

  it("auto-enables stateless zero-DB demo on Vercel when DATABASE_URL is unset", async () => {
    process.env.PUBLIC_DEMO_LOCK = "false";
    process.env.VERCEL = "1";
    delete process.env.DATABASE_URL;

    expect(isPublicDemoLocked()).toBe(true);
    expect(isStatelessDemoMode()).toBe(true);

    const dashboard = await getDashboardData(true);
    expect(dashboard.connection.id).toBe("stateless-demo");
    expect(dashboard.projects.length).toBeGreaterThan(0);
    expect(dashboard.latestScan?.status).toBe("completed");
  });

  it("fails closed in production when OWNER_PASSWORD is missing and PUBLIC_DEMO_LOCK is false", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.PUBLIC_DEMO_LOCK = "false";
    delete process.env.OWNER_PASSWORD;

    expect(isOwnerAuthMissingInProduction()).toBe(true);

    const req = new Request("https://watch.example.com/api/dashboard");
    const res = await enforceApiGuard(req);
    expect(res?.status).toBe(503);
  });

  it("verifies OWNER_PASSWORD with full UTF-8 support and rate-limits brute-force failures", async () => {
    const utf8Pass = "pässwörd-🔐-東京";
    const validHeader = encodeBasicUtf8("owner", utf8Pass);
    const wrongPassHeader = encodeBasicUtf8("owner", "wrong-pass");
    const emptyPassHeader = encodeBasicUtf8("owner", "");

    expect(await verifyOwnerBasicAuth(validHeader, utf8Pass)).toBe(true);
    expect(await verifyOwnerBasicAuth(wrongPassHeader, utf8Pass)).toBe(false);
    expect(await verifyOwnerBasicAuth(emptyPassHeader, utf8Pass)).toBe(false);
    expect(await verifyOwnerBasicAuth("Basic !!!not-base64!!!", utf8Pass)).toBe(false);
    expect(await verifyOwnerBasicAuth("Bearer token", utf8Pass)).toBe(false);
    expect(await verifyOwnerBasicAuth(null, utf8Pass)).toBe(false);

    process.env.OWNER_PASSWORD = "correct-owner-password";
    for (let i = 0; i < 10; i += 1) {
      const attempt = await enforceApiGuard(
        new Request("http://localhost:3000/api/dashboard", {
          headers: {
            "x-forwarded-for": "203.0.113.9",
            authorization: wrongPassHeader,
          },
        }),
      );
      expect(attempt?.status).toBe(401);
    }

    const eleventh = await enforceApiGuard(
      new Request("http://localhost:3000/api/dashboard", {
        headers: {
          "x-forwarded-for": "203.0.113.9",
          authorization: wrongPassHeader,
        },
      }),
    );
    expect(eleventh?.status).toBe(429);
  });

  it("blocks cross-origin and form-encoded CSRF mutations while allowing same-origin JSON", () => {
    const crossOriginReq = new Request("https://watch.example.com/api/scans", {
      method: "POST",
      headers: {
        host: "watch.example.com",
        origin: "https://evil.example.net",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(verifyCsrfMutationRequest(crossOriginReq)?.status).toBe(403);

    const formPostReq = new Request("https://watch.example.com/api/projects/demo/advise", {
      method: "POST",
      headers: {
        host: "watch.example.com",
        origin: "https://watch.example.com",
        "content-type": "text/plain",
      },
      body: '{"forceRefresh":true}',
    });
    expect(verifyCsrfMutationRequest(formPostReq)?.status).toBe(415);

    const validJsonReq = new Request("https://watch.example.com/api/scans", {
      method: "POST",
      headers: {
        host: "watch.example.com",
        origin: "https://watch.example.com",
        "content-type": "application/json; charset=utf-8",
      },
      body: '{"idempotencyKey":"12345678"}',
    });
    expect(verifyCsrfMutationRequest(validJsonReq)).toBeNull();
  });

  it("blocks ambient host AWS credentials unless ALLOW_AMBIENT_AWS_CREDENTIALS=true", () => {
    delete process.env.ALLOW_AMBIENT_AWS_CREDENTIALS;
    expect(() => assertAmbientAwsAllowed()).toThrow(/ALLOW_AMBIENT_AWS_CREDENTIALS/);

    process.env.ALLOW_AMBIENT_AWS_CREDENTIALS = "true";
    expect(() => assertAmbientAwsAllowed()).not.toThrow();
  });

  it("returns 400 on malformed JSON and sanitizes internal SQL / secret error messages", async () => {
    const badJsonReq = new Request("http://localhost:3000/api/scans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad-json",
    });

    await expect(
      parseJsonBody(badJsonReq, z.object({ idempotencyKey: z.string() })),
    ).rejects.toMatchObject({ statusCode: 400 });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const leaked = sanitizeErrorMessage(
      new Error("Failed query: INSERT INTO ai_provider_configs VALUES ('gsk_1234567890abcdefghijklmnop')"),
      "Failed to save settings.",
    );
    expect(leaked.status).toBe(500);
    expect(leaked.message).toBe("Failed to save settings.");
    expect(leaked.message).not.toContain("gsk_");
    errorSpy.mockRestore();
  });
});
