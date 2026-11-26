import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export const INSECURE_EXAMPLE_HEX_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function isWeakOrExampleHexKey(hexKey: string): boolean {
  const normalized = hexKey.toLowerCase();
  if (normalized === INSECURE_EXAMPLE_HEX_KEY) return true;
  // Reject trivial all-identical-byte keys such as 0000... or ffff...
  if (/^([0-9a-f]{2})\1{31}$/.test(normalized)) return true;
  return false;
}

function resolveKey(overrideHexKey?: string): Buffer {
  const hexKey = (overrideHexKey ?? process.env.APP_ENCRYPTION_KEY)?.trim();
  if (!hexKey || !/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error(
      "APP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) for AES-256-GCM encryption.",
    );
  }
  if (isWeakOrExampleHexKey(hexKey)) {
    throw new Error(
      "APP_ENCRYPTION_KEY is using a known example or weak key. Generate a fresh 32-byte random hex key.",
    );
  }
  return Buffer.from(hexKey, "hex");
}

export function encryptSecret(plaintext: string, overrideHexKey?: string): string {
  const key = resolveKey(overrideHexKey);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, overrideHexKey?: string): string {
  const parts = payload.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted secret format.");
  }

  const [ivB64, tagB64, dataB64] = parts;
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Incomplete encrypted secret payload.");
  }

  const key = resolveKey(overrideHexKey);
  const iv = Buffer.from(ivB64, "base64url");
  const authTag = Buffer.from(tagB64, "base64url");
  const encrypted = Buffer.from(dataB64, "base64url");

  if (iv.length !== IV_LENGTH_BYTES || authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error("Corrupted encrypted secret envelope.");
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH_BYTES,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function tryDecryptSecret(
  payload: string | null | undefined,
  overrideHexKey?: string,
): string | null {
  if (!payload) return null;
  try {
    return decryptSecret(payload, overrideHexKey);
  } catch {
    return null;
  }
}

export function maskSecret(value: string | null | undefined): {
  configured: boolean;
  last4: string | null;
} {
  if (!value || value.trim().length === 0) {
    return { configured: false, last4: null };
  }
  const trimmed = value.trim();
  return {
    configured: true,
    last4: trimmed.length >= 4 ? trimmed.slice(-4) : "••••",
  };
}
