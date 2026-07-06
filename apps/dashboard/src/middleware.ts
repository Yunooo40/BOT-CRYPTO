import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

const PUBLIC_PATHS = ["/login"];

/**
 * Presence check only — the JWT itself is re-verified by the gateway on every
 * API call, and `lib/api-client.ts` sends an expired/invalid session to
 * `/login` on a 401. This just keeps a logged-out visitor from ever rendering
 * a protected page's shell.
 */
export function middleware(request: NextRequest): NextResponse {
  const isPublic = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (!isPublic && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
