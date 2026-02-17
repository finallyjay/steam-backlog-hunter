import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getUserStats } from "@/lib/steam-stats"

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const forceRefresh = searchParams.get("refresh") === "1" || searchParams.get("force") === "1"

    const stats = await getUserStats(user.steamId, { forceRefresh })
    return NextResponse.json(stats)
  } catch (error) {
    console.error("Steam stats API error:", error)
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
