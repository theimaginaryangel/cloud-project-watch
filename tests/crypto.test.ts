import { describe, expect, it } from "vitest";
import {
  INSECURE_EXAMPLE_HEX_KEY,
  decryptSecret,
  encryptSecret,
  maskSecret,
  tryDecryptSecret,
} from "@/lib/crypto";

const TEST_HEX_KEY =
  "a3f19c8472e6b0514d98c72a1f6308e59b2d47c8a10f6e3b5c7d9a2e4f6810b3";

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

  it("rejects the public .env.example placeholder key and trivial repeated-byte keys", () => {
    expect(() => encryptSecret("secret", INSECURE_EXAMPLE_HEX_KEY)).toThrow(/known example or weak key/i);
    expect(() => encryptSecret("secret", "00".repeat(32))).toThrow(/known example or weak key/i);
    expect(() => encryptSecret("secret", "ff".repeat(32))).toThrow(/known example or weak key/i);
  });

  it("rejects tampered ciphertext via GCM auth tag and handles rotated keys safely in tryDecryptSecret", () => {
    const enc = encryptSecret("super-secret-groq-key", TEST_HEX_KEY);
    const parts = enc.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${parts[2]?.slice(0, -2)}AA`;

    expect(() => decryptSecret(tampered, TEST_HEX_KEY)).toThrow();
    expect(tryDecryptSecret(tampered, TEST_HEX_KEY)).toBeNull();

    const rotatedKey =
      "b4e28d9583f7c1625ea9d83b207419f6ac3e58d9b2107f4c6d8e0b3f507921c4";
    expect(tryDecryptSecret(enc, rotatedKey)).toBeNull();
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
