import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSessionFromRequest,
  refreshSessionCookie,
} from "@/lib/auth";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const sessionCookie = request.cookies.get("session")?.value;
  const session = await getSessionFromRequest(request);

  if (!session) {
    if (pathname !== "/login") {
      const response = NextResponse.redirect(new URL("/login", request.url));
      return clearSessionCookie(response);
    }

    if (sessionCookie) {
      const response = NextResponse.next();
      return clearSessionCookie(response);
    }

    return NextResponse.next();
  }

  if (session && pathname === "/login") {
    const response = NextResponse.redirect(new URL("/dashboard", request.url));
    return refreshSessionCookie(response, session);
  }

  if (session) {
    const response = NextResponse.next();
    return refreshSessionCookie(response, session);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
