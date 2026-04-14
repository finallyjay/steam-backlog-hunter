import { NextResponse } from "next/server"

import { getCurrentUser } from "@/app/lib/server-auth"
import { rateLimit } from "@/lib/server/rate-limit"
import { getUserSyncStatus, synchronizeUserData } from "@/lib/server/steam-store"
import { invalidateStatsCache } from "@/lib/steam-stats"
import { logger } from "@/lib/server/logger"

/**
 * GET /api/steam/sync
 *
 * Returns the current sync status timestamps for the authenticated user.
 * Includes last sync time for games, achievements, and profile data.
 *
 * @returns {{ lastSync: string, ... }} Sync status timestamps
 * @throws 401 - Unauthorized
 * @throws 500 - Server error
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    return NextResponse.json(getUserSyncStatus(user.steamId))
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/sync" }, "Steam sync status API error")
    return NextResponse.json({ error: "Failed to load Steam sync status" }, { status: 500 })
  }
}

/**
 * POST /api/steam/sync
 *
 * Triggers a full data synchronization for the authenticated user.
 * Fetches and persists all owned games, achievements, and profile data
 * from the Steam API.
 *
 * @ratelimit 5 requests per minute per user
 * @returns {{ synced: boolean, ... }} Sync result details
 * @throws 401 - Unauthorized
 * @throws 429 - Too many requests
 * @throws 500 - Server error
 */
export async function POST() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { success } = rateLimit(`sync:${user.steamId}`, 5, 60_000)
    if (!success) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const result = await synchronizeUserData(user.steamId)
    // Drop the in-memory stats cache so a follow-up GET /api/steam/stats
    // recomputes from the freshly-synced database instead of returning a
    // stale snapshot.
    invalidateStatsCache(user.steamId)
    return NextResponse.json(result)
  } catch (error) {
    logger.error({ err: error, endpoint: "steam/sync" }, "Steam sync API error")
    return NextResponse.json({ error: "Failed to synchronize Steam data" }, { status: 500 })
  }
}
