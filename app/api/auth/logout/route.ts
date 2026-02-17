import { NextResponse } from "next/server"
import { cookies } from "next/headers"

export async function POST() {
  const cookieStore = await cookies()

  // Clear the user session cookie
  cookieStore.delete("steam_user")

  return NextResponse.json({ success: true })
}
