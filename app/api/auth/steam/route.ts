import { type NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import crypto from "node:crypto"

import { rateLimit } from "@/lib/server/rate-limit"

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"

/**
 * GET /api/auth/steam
 *
 * Initiates the Steam OpenID 2.0 login flow. Generates a CSRF nonce,
 * stores it in an httpOnly cookie, and redirects the user to Steam's
 * OpenID authentication page.
 *
 * @ratelimit 10 requests per minute per IP
 * @returns Redirect to Steam OpenID login page
 * @throws 429 - Too many requests
 */
export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"
  const { success } = rateLimit(`auth:${ip}`, 10, 60_000)
  if (!success) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const realm = process.env.NEXTAUTH_URL || new URL("/", request.url).origin
  const returnUrl = `${realm}/api/auth/steam/callback`

  // Generate CSRF nonce to prevent login CSRF attacks
  const nonce = crypto.randomBytes(32).toString("hex")
  const cookieStore = await cookies()
  cookieStore.set("steam_openid_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 5, // 5 minutes — enough to complete the login flow
  })

  // Build Steam OpenID authentication URL
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": `${returnUrl}?nonce=${nonce}`,
    "openid.realm": realm,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  })

  const authUrl = `${STEAM_OPENID_URL}?${params.toString()}`

  return NextResponse.redirect(authUrl)
}
