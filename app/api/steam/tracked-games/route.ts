import { NextResponse } from "next/server"

import { getCurrentUser } from "@/app/lib/server-auth"
import { getTrackedGameIdsServer, reseedTrackedGamesServer } from "@/lib/server/tracked-games"
import { logger } from "@/lib/server/logger"

/**
 * GET /api/steam/tracked-games
 *
 * Returns the list of tracked game IDs for the authenticated user.
 * Tracked games are the subset of owned games that are actively monitored
 * for achievement progress during sync operations.
 *
 * @returns {{ appIds: number[] }} Sorted list of tracked Steam application IDs
 * @throws 401 - Unauthorized
 * @throws 500 - Server error
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const appIds = Array.from(await getTrackedGameIdsServer(user.steamId))
      .map((id) => Number(id))
      .sort((a, b) => a - b)
    return NextResponse.json({ appIds })
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/tracked-games" }, "Tracked games API error")
    return NextResponse.json({ error: "Failed to fetch tracked games" }, { status: 500 })
  }
}

/**
 * POST /api/steam/tracked-games
 *
 * Re-seeds the tracked games list from the seed file for the authenticated user.
 * Replaces the current tracked games set with entries from the configured seed source.
 *
 * @returns {{ added: number, removed: number, ... }} Reseed result details
 * @throws 401 - Unauthorized
 * @throws 500 - Server error
 */
export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const result = await reseedTrackedGamesServer(user.steamId)
    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/tracked-games" }, "Tracked games reseed API error")
    return NextResponse.json({ error: "Failed to reseed tracked games" }, { status: 500 })
  }
}
