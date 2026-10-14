import "server-only"

import { getStatsForUser } from "@/lib/server/steam-store"
import { logger } from "@/lib/server/logger"
import { getCachedStats, setCachedStats } from "@/lib/server/stats-cache"
import type { SteamStatsResponse } from "@/lib/types/steam"

export { invalidateStatsCache } from "@/lib/server/stats-cache"

/**
 * Fetches aggregate user stats, returning zeroed defaults on failure. When
 * forceRefresh is set, bypasses the in-memory cache and goes straight to
 * getStatsForUser (which itself recomputes from the database). Otherwise
 * serves from the in-memory cache when fresh. `allowStale` is forwarded so
 * request handlers get the stored snapshot without an inline sync.
 */
export async function getUserStats(
  steamId: string,
  options?: { forceRefresh?: boolean; allowStale?: boolean },
): Promise<SteamStatsResponse> {
  try {
    if (!options?.forceRefresh) {
      const cached = getCachedStats(steamId)
      if (cached) {
        return cached
      }
    }
    const stats = await getStatsForUser(steamId, options)
    setCachedStats(steamId, stats)
    return stats
  } catch (error) {
    logger.error({ err: error }, "Error fetching user stats")
    return {
      totalGames: 0,
      gamesWithAchievements: 0,
      totalAchievements: 0,
      pendingAchievements: 0,
      startedGames: 0,
      averageCompletion: 0,
      totalPlaytime: 0,
      perfectGames: 0,
    }
  }
}
