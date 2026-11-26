import { NextResponse, type NextRequest } from "next/server";
import {
  MISSING_PROD_AUTH_MESSAGE,
  checkRateLimit,
  getClientIp,
  isOwnerAuthMissingInProduction,
  verifyCsrfMutationRequest,
  verifyOwnerBasicAuth,
} from "@/lib/security/guards";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.svg" ||
    pathname.startsWith("/_next/")
  ) {
    return NextResponse.next();
  }

  if (isOwnerAuthMissingInProduction()) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: MISSING_PROD_AUTH_MESSAGE }, { status: 503 });
    }
    return new NextResponse(MISSING_PROD_AUTH_MESSAGE, { status: 503 });
  }

  const ownerPassword = process.env.OWNER_PASSWORD?.trim();
  if (ownerPassword) {
    const authorized = await verifyOwnerBasicAuth(
      request.headers.get("authorization"),
      ownerPassword,
    );

    if (!authorized) {
      const clientIp = getClientIp(request);
      const rl = checkRateLimit("auth_fail", clientIp, 10, 5 * 60 * 1000);
      if (!rl.allowed) {
        return new NextResponse("Too many failed authentication attempts.", {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfterSec) },
        });
      }

      return new NextResponse("Authentication required.", {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="CloudProjectWatch", charset="UTF-8"',
        },
      });
    }
  }

  if (pathname.startsWith("/api/")) {
    const csrfBlocked = verifyCsrfMutationRequest(request);
    if (csrfBlocked) return csrfBlocked;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
