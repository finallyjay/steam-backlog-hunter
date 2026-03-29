import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getUserStats } from "@/lib/steam-stats"
import { logger } from "@/lib/server/logger"

/**
 * GET /api/steam/stats
 *
 * Returns aggregated achievement and game statistics for the authenticated user.
 * Includes totals, completion rates, and historical snapshots.
 *
 * @query refresh - Force refresh from Steam API: "1" to enable (string, optional)
 * @query force - Alias for refresh (string, optional)
 * @returns {{ totalGames: number, totalAchievements: number, ... }} Aggregated user stats
 * @throws 401 - Unauthorized
 * @throws 500 - Server error
 */
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
    logger.error({ err: error, endpoint: "steam/stats" }, "Steam stats API error")
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
