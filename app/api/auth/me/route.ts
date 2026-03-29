import { getCurrentUser } from "@/app/lib/server-auth"
import { NextResponse } from "next/server"
import type { AuthMeResponse } from "@/lib/types/api"

/**
 * GET /api/auth/me
 *
 * Returns the currently authenticated user from the session cookie.
 * Used by the client to check authentication status and retrieve user info.
 *
 * @returns {{ user: SteamUser }} Current authenticated user
 * @throws 401 - Unauthorized if no valid session exists
 */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    const response: AuthMeResponse = { user: null }
    return NextResponse.json(response, { status: 401 })
  }
  const response: AuthMeResponse = { user }
  return NextResponse.json(response, { status: 200 })
}
