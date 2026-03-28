import { type NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"
import crypto from "node:crypto"

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"

export async function GET(request: NextRequest) {
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
