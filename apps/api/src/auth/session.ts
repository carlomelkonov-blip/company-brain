import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/** Signed, stateless session cookie: base64url(payload).base64url(hmac). */

export interface Session {
  tenant: string;
  personId: string;
  exp: number;
}

export const SESSION_COOKIE = "cb_session";
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

const b64 = (buf: Buffer) => buf.toString("base64url");

function sign(data: string): string {
  return b64(createHmac("sha256", config().SESSION_SECRET).update(data).digest());
}

export function encodeSession(s: Omit<Session, "exp">, now = Date.now()): string {
  const payload = b64(Buffer.from(JSON.stringify({ ...s, exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS })));
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (typeof s.exp !== "number" || s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}
