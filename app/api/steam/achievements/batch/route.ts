import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getBatchStoredAchievements } from "@/lib/server/steam-store"

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const appIdsParam = searchParams.get("appIds")

    if (!appIdsParam) {
      return NextResponse.json({ error: "appIds parameter required" }, { status: 400 })
    }

    const appIds = appIdsParam
      .split(",")
      .map(Number)
      .filter((id) => Number.isFinite(id) && id > 0)
      .slice(0, 200)

    if (appIds.length === 0) {
      return NextResponse.json({ error: "No valid app IDs provided" }, { status: 400 })
    }

    const achievementsMap = getBatchStoredAchievements(user.steamId, appIds)

    return NextResponse.json({ achievementsMap })
  } catch (error) {
    console.error("Steam batch achievements API error:", error)
    return NextResponse.json({ error: "Failed to fetch achievements" }, { status: 500 })
  }
}
