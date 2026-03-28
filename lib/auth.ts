import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "session";
const SESSION_DURATION_MS = 2 * 60 * 60 * 1000;
const secretKey = "secret";
const key = new TextEncoder().encode(process.env.JWT_SECRET || secretKey);

export type SessionUser = {
  id: string;
  email: string;
};

export type SessionToken = Record<string, unknown> & {
  user: SessionUser;
};

function sessionCookieOptions(expires: Date) {
  return {
    expires,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

function isSessionUser(value: unknown): value is SessionUser {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SessionUser).id === "string" &&
    typeof (value as SessionUser).email === "string"
  );
}

function isSessionToken(payload: unknown): payload is SessionToken {
  return (
    typeof payload === "object" &&
    payload !== null &&
    isSessionUser((payload as SessionToken).user)
  );
}

export async function encrypt(payload: SessionToken) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(key);
}

export async function decrypt(input: string): Promise<SessionToken | null> {
  try {
    const { payload } = await jwtVerify(input, key, {
      algorithms: ["HS256"],
    });

    return isSessionToken(payload) ? payload : null;
  } catch {
    return null;
  }
}

export async function createSession(user: SessionUser) {
  const expires = new Date(Date.now() + SESSION_DURATION_MS);
  const token = await encrypt({ user });
  return { token, expires };
}

export async function login(user: SessionUser) {
  const { token, expires } = await createSession(user);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(expires));
}

export async function logout() {
  (await cookies()).set(
    SESSION_COOKIE,
    "",
    sessionCookieOptions(new Date(0))
  );
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    ...sessionCookieOptions(new Date(0)),
  });
  return response;
}

export async function setSessionCookie(
  response: NextResponse,
  user: SessionUser
) {
  const { token, expires } = await createSession(user);
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    ...sessionCookieOptions(expires),
  });
  return response;
}

export async function refreshSessionCookie(
  response: NextResponse,
  session: SessionToken
) {
  return setSessionCookie(response, session.user);
}

export async function getSession() {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!session) return null;
  return await decrypt(session);
}

export async function getSessionFromRequest(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE)?.value;
  if (!session) return null;
  return await decrypt(session);
}

export async function updateSession(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return;

  const response = NextResponse.next();
  await refreshSessionCookie(response, session);
  return response;
}
