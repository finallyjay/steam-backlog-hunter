import { NextResponse } from "next/server"
import { cookies } from "next/headers"

/**
 * POST /api/auth/logout
 *
 * Clears the steam_user session cookie, ending the current user session.
 *
 * @returns {{ success: boolean }} Logout confirmation
 */
export async function POST() {
  const cookieStore = await cookies()

  // Clear the user session cookie
  cookieStore.delete("steam_user")

  return NextResponse.json({ success: true })
}
