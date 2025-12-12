import { type NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()

  // Clear the user session cookie
  cookieStore.delete("steam_user")

  return NextResponse.json({ success: true })
}
