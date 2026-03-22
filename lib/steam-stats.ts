import "server-only"

import { getStatsForUser } from "@/lib/server/steam-store"
import type { SteamStatsResponse } from "@/lib/types/steam"

export async function getUserStats(
  steamId: string,
  options?: { forceRefresh?: boolean },
): Promise<SteamStatsResponse> {
  try {
    return await getStatsForUser(steamId, options)
  } catch (error) {
    console.error("Error fetching user stats:", error)
    return {
      totalGames: 0,
      totalAchievements: 0,
      pendingAchievements: 0,
      totalPlaytime: 0,
      perfectGames: 0,
    }
  }
}
