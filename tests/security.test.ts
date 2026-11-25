import { afterEach, describe, expect, it } from "vitest";
import { getDashboardData } from "@/lib/scans/orchestrator";
import {
  blockIfPublicDemoLocked,
  isPublicDemoLocked,
  isStatelessDemoMode,
  verifyOwnerBasicAuth,
} from "@/lib/security/guards";

describe("Security guards (PUBLIC_DEMO_LOCK, stateless zero-DB demo & OWNER_PASSWORD)", () => {
  const originalLock = process.env.PUBLIC_DEMO_LOCK;
  const originalVercel = process.env.VERCEL;
  const originalDbUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalLock === undefined) delete process.env.PUBLIC_DEMO_LOCK;
    else process.env.PUBLIC_DEMO_LOCK = originalLock;

    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;

    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;
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

  it("verifies OWNER_PASSWORD via HTTP Basic Auth and rejects wrong or malformed headers", async () => {
    const validHeader = `Basic ${btoa("owner:my-strong-pass-123")}`;
    const wrongPassHeader = `Basic ${btoa("owner:wrong-pass")}`;
    const emptyPassHeader = `Basic ${btoa("owner:")}`;

    expect(await verifyOwnerBasicAuth(validHeader, "my-strong-pass-123")).toBe(true);
    expect(await verifyOwnerBasicAuth(wrongPassHeader, "my-strong-pass-123")).toBe(false);
    expect(await verifyOwnerBasicAuth(emptyPassHeader, "my-strong-pass-123")).toBe(false);
    expect(await verifyOwnerBasicAuth("Bearer token", "my-strong-pass-123")).toBe(false);
    expect(await verifyOwnerBasicAuth(null, "my-strong-pass-123")).toBe(false);
  });
});
