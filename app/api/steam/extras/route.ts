import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getExtraGamesForUser, getHiddenGamesForUser } from "@/lib/server/extra-games"
import { logger } from "@/lib/server/logger"

/**
 * GET /api/steam/extras
 *
 * Returns the authenticated user's "extras" — games they've played at least
 * once (per ClientGetLastPlayedTimes) but don't own in the main library.
 * Sourced from the dedicated `extra_games` table, never from user_games, so
 * the payload can never contaminate library stats.
 *
 * @query hidden - If "1", returns all hidden games (library + extras) instead
 * @returns {{ games: ExtraGame[] }} or {{ games: HiddenGame[] }} ordered by playtime_forever DESC
 * @throws 401 - Unauthorized
 * @throws 500 - Server error
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const hidden = request.nextUrl.searchParams.get("hidden") === "1"

    const games = hidden ? getHiddenGamesForUser(user.steamId) : getExtraGamesForUser(user.steamId)
    return NextResponse.json({ games })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/extras" }, "Steam extras API error")
    return NextResponse.json({ error: "Failed to fetch extras" }, { status: 500 })
  }
}
