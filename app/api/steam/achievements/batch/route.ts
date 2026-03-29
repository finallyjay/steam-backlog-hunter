import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getBatchStoredAchievements } from "@/lib/server/steam-store"
import { logger } from "@/lib/server/logger"

const MAX_BATCH_SIZE = 200

/**
 * GET /api/steam/achievements/batch
 *
 * Returns stored achievements for multiple games in a single request.
 * App IDs are capped at 200 per request. Only returns previously cached data.
 *
 * @query appIds - Comma-separated list of Steam application IDs (string, required, max 200)
 * @returns {{ achievementsMap: Record<number, Achievement[]> }} Map of app ID to achievements
 * @throws 400 - appIds parameter required or no valid app IDs provided
 * @throws 401 - Unauthorized
 * @throws 500 - Server error
 */
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
      .slice(0, MAX_BATCH_SIZE)

    if (appIds.length === 0) {
      return NextResponse.json({ error: "No valid app IDs provided" }, { status: 400 })
    }

    const achievementsMap = getBatchStoredAchievements(user.steamId, appIds)

    return NextResponse.json({ achievementsMap })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/achievements/batch" }, "Steam batch achievements API error")
    return NextResponse.json({ error: "Failed to fetch achievements" }, { status: 500 })
  }
}
