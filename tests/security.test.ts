import { afterEach, describe, expect, it } from "vitest";
import {
  blockIfPublicDemoLocked,
  isPublicDemoLocked,
  verifyOwnerBasicAuth,
} from "@/lib/security/guards";

describe("Security guards (PUBLIC_DEMO_LOCK & OWNER_PASSWORD)", () => {
  const originalLock = process.env.PUBLIC_DEMO_LOCK;

  afterEach(() => {
    if (originalLock === undefined) {
      delete process.env.PUBLIC_DEMO_LOCK;
    } else {
      process.env.PUBLIC_DEMO_LOCK = originalLock;
    }
  });

  it("blocks mutations with 403 when PUBLIC_DEMO_LOCK=true and allows when false", () => {
    process.env.PUBLIC_DEMO_LOCK = "true";
    expect(isPublicDemoLocked()).toBe(true);
    const blocked = blockIfPublicDemoLocked();
    expect(blocked?.status).toBe(403);

    process.env.PUBLIC_DEMO_LOCK = "false";
    expect(isPublicDemoLocked()).toBe(false);
    expect(blockIfPublicDemoLocked()).toBeNull();
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
