import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getAchievementsForGame } from "@/lib/server/steam-store"

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const appId = searchParams.get("appId")
    const forceRefresh = searchParams.get("refresh") === "1" || searchParams.get("force") === "1"

    const appIdNum = Number(appId)
    if (!appId || !Number.isFinite(appIdNum) || appIdNum <= 0) {
      return NextResponse.json({ error: "Valid App ID required" }, { status: 400 })
    }

    const achievements = await getAchievementsForGame(user.steamId, appIdNum, { forceRefresh })
    if (!achievements) {
      return NextResponse.json({ error: "Failed to fetch achievements" }, { status: 404 })
    }
    return NextResponse.json(achievements)
  } catch (error) {
    console.error("Steam achievements API error:", error)
    return NextResponse.json(
      { error: "Failed to fetch achievements" },
      { status: 500 },
    )
  }
}
