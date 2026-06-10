import "server-only"

import crypto from "node:crypto"
import { env } from "@/lib/env"
import type { SteamUser } from "@/lib/auth"

// HMAC key for signing the session cookie. A dedicated SESSION_SECRET is
// preferred; we fall back to STEAM_API_KEY (also a server-only secret) so
// sessions are tamper-proof without requiring a new env var.
function signingKey(): string {
  return env.SESSION_SECRET || env.STEAM_API_KEY
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url")
}

/**
 * Encodes a user into a signed session token: `<base64url(json)>.<hmac>`.
 * The signature is what makes the cookie tamper-proof — a forged payload (even
 * with a whitelisted Steam ID) won't carry a valid HMAC.
 */
export function signSession(user: SteamUser): string {
  const payload = Buffer.from(JSON.stringify(user)).toString("base64url")
  return `${payload}.${hmac(payload)}`
}

/**
 * Verifies a session token and returns the user, or null if the token is
 * missing, malformed, or its signature doesn't match (tampered/forged).
 */
export function verifySession(token: string | undefined | null): SteamUser | null {
  if (!token) return null

  const dot = token.lastIndexOf(".")
  if (dot <= 0) return null

  const payload = token.slice(0, dot)
  const signature = token.slice(dot + 1)

  const expected = hmac(payload)
  const sigBuf = Buffer.from(signature)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SteamUser
  } catch {
    return null
  }
}
