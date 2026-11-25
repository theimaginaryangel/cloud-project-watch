import { NextResponse, type NextRequest } from "next/server";
import { verifyOwnerBasicAuth } from "@/lib/security/guards";

export async function middleware(request: NextRequest) {
  const ownerPassword = process.env.OWNER_PASSWORD?.trim();
  if (!ownerPassword) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  if (
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.svg" ||
    pathname.startsWith("/_next/")
  ) {
    return NextResponse.next();
  }

  const authorized = await verifyOwnerBasicAuth(
    request.headers.get("authorization"),
    ownerPassword,
  );

  if (!authorized) {
    return new NextResponse("Authentication required.", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="CloudProjectWatch", charset="UTF-8"',
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
