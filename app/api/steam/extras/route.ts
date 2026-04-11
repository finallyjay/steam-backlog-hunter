import { NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getExtraGamesForUser } from "@/lib/server/extra-games"
import { logger } from "@/lib/server/logger"

/**
 * GET /api/steam/extras
 *
 * Returns the authenticated user's "extras" — games they've played at least
 * once (per ClientGetLastPlayedTimes) but don't own in the main library.
 * Sourced from the dedicated `extra_games` table, never from user_games, so
 * the payload can never contaminate library stats.
 *
 * @returns {{ games: ExtraGame[] }} ordered by playtime_forever DESC
 * @throws 401 - Unauthorized
 * @throws 500 - Server error
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const games = getExtraGamesForUser(user.steamId)
    return NextResponse.json({ games })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/extras" }, "Steam extras API error")
    return NextResponse.json({ error: "Failed to fetch extras" }, { status: 500 })
  }
}
