import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";

const TEST_HEX_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("AES-256-GCM BYOK secret encryption", () => {
  it("encrypts with unique random IVs and round-trips accurately", () => {
    const plaintext = "AKIAIOSFODNN7EXAMPLE";
    const enc1 = encryptSecret(plaintext, TEST_HEX_KEY);
    const enc2 = encryptSecret(plaintext, TEST_HEX_KEY);

    expect(enc1).not.toBe(enc2);
    expect(enc1).not.toContain(plaintext);
    expect(decryptSecret(enc1, TEST_HEX_KEY)).toBe(plaintext);
    expect(decryptSecret(enc2, TEST_HEX_KEY)).toBe(plaintext);
  });

  it("rejects tampered ciphertext via GCM auth tag", () => {
    const enc = encryptSecret("super-secret-groq-key", TEST_HEX_KEY);
    const parts = enc.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -2)}AA`;

    expect(() => decryptSecret(tampered, TEST_HEX_KEY)).toThrow();
  });

  it("masks secrets safely without leaking prefix", () => {
    expect(maskSecret("gsk_1234567890ABCD")).toEqual({
      configured: true,
      last4: "ABCD",
    });
    expect(maskSecret("")).toEqual({ configured: false, last4: null });
    expect(maskSecret(null)).toEqual({ configured: false, last4: null });
  });
});
