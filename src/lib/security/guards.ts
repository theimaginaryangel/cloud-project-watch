import { NextResponse } from "next/server";
import type { z } from "zod";

export const PUBLIC_DEMO_LOCK_MESSAGE =
  "Public demo is read-only. Self-host or deploy your own copy to connect AWS credentials, API keys, or custom rules.";

export const AMBIENT_AWS_DISABLED_MESSAGE =
  "Local/ambient AWS credentials (env_default) are disabled. Set ALLOW_AMBIENT_AWS_CREDENTIALS=true on trusted local machines or use read-only IAM keys.";

export const MISSING_PROD_AUTH_MESSAGE =
  "Server authentication is not configured. Set OWNER_PASSWORD for private deployments or PUBLIC_DEMO_LOCK=true for a read-only public demo.";

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_RATE_LIMIT_BUCKETS = 5_000;

export class AppError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
  }
}

export function isPublicDemoLocked(): boolean {
  if ((process.env.PUBLIC_DEMO_LOCK ?? "false").trim().toLowerCase() === "true") {
    return true;
  }
  // On Vercel without a DATABASE_URL, automatically run as a read-only zero-DB public demo.
  if (Boolean(process.env.VERCEL) && !process.env.DATABASE_URL?.trim()) {
    return true;
  }
  return false;
}

export function isStatelessDemoMode(): boolean {
  if (isPublicDemoLocked()) return true;
  if (
    !process.env.DATABASE_URL?.trim() &&
    (process.env.DEMO_MODE ?? "true").trim().toLowerCase() === "true" &&
    Boolean(process.env.VERCEL)
  ) {
    return true;
  }
  return false;
}

export function isAmbientAwsAllowed(): boolean {
  return (
    (process.env.ALLOW_AMBIENT_AWS_CREDENTIALS ?? "false").trim().toLowerCase() ===
    "true"
  );
}

export function assertAmbientAwsAllowed(): void {
  if (!isAmbientAwsAllowed()) {
    throw new AppError(AMBIENT_AWS_DISABLED_MESSAGE, 403);
  }
}

export function isOwnerAuthMissingInProduction(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    !isPublicDemoLocked() &&
    !process.env.OWNER_PASSWORD?.trim()
  );
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
 * Decodes standard Base64 as strict UTF-8 (RFC 7617 `charset="UTF-8"`), compatible
 * with both Node.js and Edge runtimes without `atob`'s Latin-1 corruption.
 */
export function decodeBase64Utf8(b64Input: string): string | null {
  const cleaned = b64Input.trim();
  if (!cleaned || cleaned.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
    return null;
  }

  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Verifies HTTP Basic Auth against OWNER_PASSWORD using constant-time SHA-256 comparison.
 * Accepts any username paired with a non-empty OWNER_PASSWORD.
 */
export async function verifyOwnerBasicAuth(
  authorizationHeader: string | null,
  ownerPassword: string,
): Promise<boolean> {
  if (!ownerPassword || !authorizationHeader || !authorizationHeader.startsWith("Basic ")) {
    return false;
  }

  const decoded = decodeBase64Utf8(authorizationHeader.slice(6));
  if (!decoded) return false;

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

interface RateLimitEntry {
  count: number;
  resetAtMs: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

function pruneExpiredRateLimits(nowMs: number) {
  if (rateLimitStore.size < MAX_RATE_LIMIT_BUCKETS) return;
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAtMs <= nowMs) {
      rateLimitStore.delete(key);
    }
  }
  if (rateLimitStore.size >= MAX_RATE_LIMIT_BUCKETS) {
    const oldestKey = rateLimitStore.keys().next().value;
    if (oldestKey) rateLimitStore.delete(oldestKey);
  }
}

export function checkRateLimit(
  bucket: string,
  clientKey: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now(),
): { allowed: boolean; retryAfterSec: number } {
  const compositeKey = `${bucket}:${clientKey}`;
  const existing = rateLimitStore.get(compositeKey);

  if (!existing || existing.resetAtMs <= nowMs) {
    pruneExpiredRateLimits(nowMs);
    rateLimitStore.set(compositeKey, { count: 1, resetAtMs: nowMs + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

export function resetRateLimitsForTests(): void {
  rateLimitStore.clear();
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "local";
}

function getExpectedHost(request: Request): string | null {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) return forwardedHost.toLowerCase();
  const host = request.headers.get("host")?.trim();
  if (host) return host.toLowerCase();
  try {
    return new URL(request.url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Protects state-changing API endpoints against CSRF (especially important when
 * browsers cache HTTP Basic Auth credentials) by enforcing same-origin headers
 * and `Content-Type: application/json`.
 */
export function verifyCsrfMutationRequest(request: Request): NextResponse | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const secFetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (secFetchSite === "cross-site") {
    return NextResponse.json(
      { error: "Cross-site mutation requests are forbidden." },
      { status: 403 },
    );
  }

  const expectedHost = getExpectedHost(request);
  const originHeader = request.headers.get("origin");
  const refererHeader = request.headers.get("referer");
  const sourceUrl = originHeader || refererHeader;

  if (sourceUrl && expectedHost) {
    try {
      const parsedHost = new URL(sourceUrl).host.toLowerCase();
      if (parsedHost !== expectedHost) {
        return NextResponse.json(
          { error: "Cross-origin mutation request blocked." },
          { status: 403 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Invalid Origin or Referer header." },
        { status: 403 },
      );
    }
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json." },
      { status: 415 },
    );
  }

  return null;
}

export interface ApiGuardOptions {
  mutation?: boolean;
  blockDemo?: boolean;
  rateLimit?: {
    bucket: string;
    limit: number;
    windowMs: number;
  };
}

export async function enforceApiGuard(
  request: Request,
  options: ApiGuardOptions = {},
): Promise<NextResponse | null> {
  if (isOwnerAuthMissingInProduction()) {
    return NextResponse.json({ error: MISSING_PROD_AUTH_MESSAGE }, { status: 503 });
  }

  const clientIp = getClientIp(request);
  const ownerPassword = process.env.OWNER_PASSWORD?.trim();

  if (ownerPassword) {
    const authorized = await verifyOwnerBasicAuth(
      request.headers.get("authorization"),
      ownerPassword,
    );
    if (!authorized) {
      const failCheck = checkRateLimit("auth_fail", clientIp, 10, 5 * 60 * 1000);
      if (!failCheck.allowed) {
        return NextResponse.json(
          { error: "Too many failed authentication attempts. Try again shortly." },
          {
            status: 429,
            headers: { "Retry-After": String(failCheck.retryAfterSec) },
          },
        );
      }
      return new NextResponse(JSON.stringify({ error: "Authentication required." }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Basic realm="CloudProjectWatch", charset="UTF-8"',
        },
      });
    }
  }

  if (options.mutation) {
    const csrfBlocked = verifyCsrfMutationRequest(request);
    if (csrfBlocked) return csrfBlocked;
  }

  if (options.blockDemo) {
    const demoBlocked = blockIfPublicDemoLocked();
    if (demoBlocked) return demoBlocked;
  }

  if (options.rateLimit) {
    const rl = checkRateLimit(
      options.rateLimit.bucket,
      clientIp,
      options.rateLimit.limit,
      options.rateLimit.windowMs,
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait a moment before retrying." },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSec) },
        },
      );
    }
  }

  return null;
}

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  options: { allowEmpty?: boolean; invalidMessage?: string } = {},
): Promise<T> {
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new AppError("Request payload exceeds maximum allowed size (64 KB).", 413);
  }

  let jsonValue: unknown = {};
  if (raw.trim().length > 0) {
    try {
      jsonValue = JSON.parse(raw);
    } catch {
      throw new AppError("Malformed JSON in request body.", 400);
    }
  } else if (!options.allowEmpty) {
    throw new AppError("Request body cannot be empty.", 400);
  }

  const parsed = schema.safeParse(jsonValue);
  if (!parsed.success) {
    throw new AppError(options.invalidMessage ?? "Invalid request payload.", 400);
  }

  return parsed.data;
}

export function safeDecodeUriSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new AppError("Malformed URL parameter.", 400);
  }
}

function redactSecrets(text: string): string {
  return text
    .replace(/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "$1****************")
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, "AIza************************")
    .replace(/\bgsk_[0-9A-Za-z_-]{20,}\b/g, "gsk_************************");
}

export function sanitizeErrorMessage(
  err: unknown,
  fallback = "An unexpected server error occurred.",
): { message: string; status: number } {
  if (err instanceof AppError) {
    return { message: redactSecrets(err.message), status: err.statusCode };
  }

  if (err instanceof Error) {
    const name = err.name || "";
    const msg = err.message || "";

    if (
      name === "InvalidClientTokenId" ||
      name === "SignatureDoesNotMatch" ||
      name === "UnrecognizedClientException" ||
      name === "ExpiredToken" ||
      name === "ExpiredTokenException" ||
      name === "CredentialsProviderError"
    ) {
      return {
        message: "AWS credentials were rejected or could not be resolved.",
        status: 400,
      };
    }

    if (name === "AccessDenied" || name === "AccessDeniedException" || name === "UnauthorizedOperation") {
      return {
        message: "AWS IAM policy denied this read-only action. Check your IAM policy permissions.",
        status: 403,
      };
    }

    if (name === "TimeoutError" || name === "AbortError" || /timed out/i.test(msg)) {
      return {
        message: "Upstream provider request timed out. Please try again.",
        status: 504,
      };
    }

    if (/APP_ENCRYPTION_KEY/i.test(msg)) {
      return {
        message:
          "Server encryption key (APP_ENCRYPTION_KEY) is missing or invalid. Configure a 64-character hex key in .env.",
        status: 500,
      };
    }

    console.error("[CloudProjectWatch Error]", name, redactSecrets(msg));
  }

  return { message: fallback, status: 500 };
}

export function toErrorResponse(
  err: unknown,
  fallback = "An unexpected server error occurred.",
): NextResponse {
  const { message, status } = sanitizeErrorMessage(err, fallback);
  return NextResponse.json({ error: message }, { status });
}
