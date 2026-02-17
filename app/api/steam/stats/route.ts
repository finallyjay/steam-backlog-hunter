import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getUserStats } from "@/lib/steam-stats"

export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const stats = await getUserStats(user.steamId)
    return NextResponse.json(stats)
  } catch (error) {
    console.error("Steam stats API error:", error)
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
