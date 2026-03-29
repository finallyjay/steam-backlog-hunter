import "server-only"

import { getStatsForUser } from "@/lib/server/steam-store"
import { logger } from "@/lib/server/logger"
import type { SteamStatsResponse } from "@/lib/types/steam"

/** Fetches aggregate user stats, returning zeroed defaults on failure. */
export async function getUserStats(steamId: string, options?: { forceRefresh?: boolean }): Promise<SteamStatsResponse> {
  try {
    return await getStatsForUser(steamId, options)
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
