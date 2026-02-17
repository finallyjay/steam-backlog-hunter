import { getCurrentUser } from "@/app/lib/server-auth"
import { NextResponse } from "next/server"
import type { AuthMeResponse } from "@/lib/types/api"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    const response: AuthMeResponse = { user: null }
    return NextResponse.json(response, { status: 401 })
  }
  const response: AuthMeResponse = { user }
  return NextResponse.json(response, { status: 200 })
}
