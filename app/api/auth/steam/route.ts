import { type NextRequest, NextResponse } from "next/server"

const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"
const REALM = process.env.NEXTAUTH_URL || "http://localhost:3000"
const RETURN_URL = `${REALM}/api/auth/steam/callback`

export async function GET(request: NextRequest) {
  // Build Steam OpenID authentication URL
  const params = new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "checkid_setup",
    "openid.return_to": RETURN_URL,
    "openid.realm": REALM,
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
  })

  const authUrl = `${STEAM_OPENID_URL}?${params.toString()}`

  return NextResponse.redirect(authUrl)
}
