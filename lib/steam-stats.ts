import "server-only"

import { getAllowedGameIdsServer } from "@/lib/allowed-games"
import { getOwnedGames, getPlayerAchievements } from "@/lib/steam-api"
import type { SteamStatsResponse } from "@/lib/types/steam"

export async function getUserStats(steamId: string): Promise<SteamStatsResponse> {
  try {
    const games = await getOwnedGames(steamId)

    let totalAchievements = 0
    let perfectGames = 0

    let allowedIds = new Set<string>()
    try {
      allowedIds = await getAllowedGameIdsServer()
    } catch (error) {
      console.error("Error loading allowed games list:", error)
    }

    const sampleGames = games.filter((game) => allowedIds.has(String(game.appid)))

    for (const game of sampleGames) {
      const achievements = await getPlayerAchievements(steamId, game.appid)
      if (!achievements) continue

      const unlockedCount = achievements.achievements.filter((a) => a.achieved === 1).length
      totalAchievements += unlockedCount

      if (unlockedCount === achievements.achievements.length && achievements.achievements.length > 0) {
        perfectGames++
      }
    }

    const totalPlaytime = games.reduce((sum, game) => sum + game.playtime_forever, 0)

    return {
      totalGames: games.length,
      totalAchievements,
      totalPlaytime: Math.round(totalPlaytime / 60),
      perfectGames,
    }
  } catch (error) {
    console.error("Error fetching user stats:", error)
    return {
      totalGames: 0,
      totalAchievements: 0,
      totalPlaytime: 0,
      perfectGames: 0,
    }
  }
}
