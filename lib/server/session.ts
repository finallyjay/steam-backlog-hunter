import "server-only"

import crypto from "node:crypto"
import { env } from "@/lib/env"
import type { SteamUser } from "@/lib/auth"

// How long a signed session token is valid for. Kept in sync with the
// `steam_user` cookie's maxAge in app/api/auth/steam/callback/route.ts — the
// cookie is just the browser-enforced expiry; this is the server-enforced one
// baked into the signature itself, so a copied/stolen cookie can't outlive it.
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // 7 days

type SignedPayload = SteamUser & { exp: number }

// HMAC key for signing the session cookie. A dedicated SESSION_SECRET is
// preferred; we fall back to STEAM_API_KEY (also a server-only secret) so
// sessions are tamper-proof without requiring a new env var. In production,
// lib/env.ts fails fast unless SESSION_SECRET is set (see there for why).
function signingKey(): string {
  return env.SESSION_SECRET || env.STEAM_API_KEY
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", signingKey()).update(payload).digest("base64url")
}

/**
 * Encodes a user into a signed session token: `<base64url(json)>.<hmac>`.
 * The signature is what makes the cookie tamper-proof — a forged payload (even
 * with a whitelisted Steam ID) won't carry a valid HMAC. The payload also
 * carries a signed `exp` timestamp so a stolen token can't be replayed
 * forever — verifySession() enforces it independently of the cookie's own
 * (browser-enforced, hence spoofable) maxAge.
 */
export function signSession(user: SteamUser): string {
  const withExpiry: SignedPayload = { ...user, exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000 }
  const payload = Buffer.from(JSON.stringify(withExpiry)).toString("base64url")
  return `${payload}.${hmac(payload)}`
}

/**
 * Verifies a session token and returns the user, or null if the token is
 * missing, malformed, expired, or its signature doesn't match (tampered/forged).
 *
 * Tokens signed before this expiry check existed carry no `exp` field at all
 * and are rejected (treated the same as an expired token) rather than granted
 * a grace period: they're indistinguishable from a forged payload that simply
 * omits `exp`, and honoring them would let a token stolen before this fix
 * shipped keep working indefinitely — exactly the bug this closes. The cost
 * is a single forced re-login per affected user.
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
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SignedPayload> | null
    if (!parsed || typeof parsed !== "object") return null

    const { exp, ...user } = parsed
    if (typeof exp !== "number" || Date.now() >= exp) return null

    return user as SteamUser
  } catch {
    return null
  }
}
