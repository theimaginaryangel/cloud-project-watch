import { NextResponse } from "next/server";

export const PUBLIC_DEMO_LOCK_MESSAGE =
  "Public demo is read-only. Self-host or deploy your own copy to connect AWS credentials, API keys, or custom rules.";

export function isPublicDemoLocked(): boolean {
  return (process.env.PUBLIC_DEMO_LOCK ?? "false").trim().toLowerCase() === "true";
}

export function blockIfPublicDemoLocked(): NextResponse | null {
  if (!isPublicDemoLocked()) return null;
  return NextResponse.json({ error: PUBLIC_DEMO_LOCK_MESSAGE }, { status: 403 });
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

/**
 * Verifies HTTP Basic Auth against OWNER_PASSWORD using constant-time SHA-256 comparison
 * (compatible with both Node.js and Next.js Edge Middleware).
 * Accepts any non-empty username paired with OWNER_PASSWORD.
 */
export async function verifyOwnerBasicAuth(
  authorizationHeader: string | null,
  ownerPassword: string,
): Promise<boolean> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Basic ")) {
    return false;
  }

  let decoded = "";
  try {
    decoded = atob(authorizationHeader.slice(6).trim());
  } catch {
    return false;
  }

  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return false;

  const providedPassword = decoded.slice(colonIdx + 1);
  if (!providedPassword) return false;

  const [providedHash, expectedHash] = await Promise.all([
    sha256Bytes(providedPassword),
    sha256Bytes(ownerPassword),
  ]);

  return timingSafeEqualBytes(providedHash, expectedHash);
}
