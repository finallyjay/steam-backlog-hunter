import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getOwnedGamesForUser, getRecentlyPlayedGamesForUser } from "@/lib/server/steam-store"
import { logger } from "@/lib/server/logger"

/**
 * GET /api/steam/games
 *
 * Returns owned or recently played games for the authenticated user.
 * Supports forced refresh to bypass cache staleness thresholds.
 *
 * @query type - Game list type: "all" for full library, "recent" for recently played (string, default "recent")
 * @query refresh - Force refresh from Steam API: "1" to enable (string, optional)
 * @query force - Alias for refresh (string, optional)
 * @returns {{ games: Game[] }} List of games
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
    const type = searchParams.get("type") || "recent"
    const forceRefresh = searchParams.get("refresh") === "1" || searchParams.get("force") === "1"

    let games
    if (type === "all") {
      games = await getOwnedGamesForUser(user.steamId, { forceRefresh })
    } else {
      games = await getRecentlyPlayedGamesForUser(user.steamId, { forceRefresh })
    }

    return NextResponse.json({ games })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/games" }, "Steam games API error")
    return NextResponse.json({ error: "Failed to fetch games" }, { status: 500 })
  }
}
