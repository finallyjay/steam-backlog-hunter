import "server-only"

import { getAllowedGameIdsServer } from "@/lib/allowed-games"
import { buildCacheKey, getJson, setJson } from "@/lib/server/cache"
import { getOwnedGamesCached, getPlayerAchievementsCached } from "@/lib/steam-api-cached"
import type { SteamStatsResponse } from "@/lib/types/steam"

const STATS_CACHE_TTL_SECONDS = 2 * 60
const ACHIEVEMENTS_CONCURRENCY = 8

export async function getUserStats(
  steamId: string,
  options?: { forceRefresh?: boolean },
): Promise<SteamStatsResponse> {
  const forceRefresh = options?.forceRefresh ?? false
  const key = buildCacheKey(["stats", steamId])

  if (!forceRefresh) {
    const cached = await getJson<SteamStatsResponse>(key)
    if (cached) {
      return cached
    }
  }

  try {
    const games = await getOwnedGamesCached(steamId, { forceRefresh })

    let totalAchievements = 0
    let perfectGames = 0

    let allowedIds = new Set<string>()
    try {
      allowedIds = await getAllowedGameIdsServer()
    } catch (error) {
      console.error("Error loading allowed games list:", error)
    }

    const sampleGames = games.filter((game) => allowedIds.has(String(game.appid)))

    // Limit parallel requests to Steam API to reduce total latency without overwhelming upstream.
    for (let index = 0; index < sampleGames.length; index += ACHIEVEMENTS_CONCURRENCY) {
      const chunk = sampleGames.slice(index, index + ACHIEVEMENTS_CONCURRENCY)
      const chunkResults = await Promise.allSettled(
        chunk.map((game) => getPlayerAchievementsCached(steamId, game.appid, { forceRefresh })),
      )

      for (const result of chunkResults) {
        if (result.status !== "fulfilled" || !result.value) {
          continue
        }

        const unlockedCount = result.value.achievements.filter((achievement) => achievement.achieved === 1).length
        totalAchievements += unlockedCount

        if (
          unlockedCount === result.value.achievements.length &&
          result.value.achievements.length > 0
        ) {
          perfectGames++
        }
      }
    }

    const totalPlaytime = games.reduce((sum, game) => sum + game.playtime_forever, 0)

    const stats = {
      totalGames: games.length,
      totalAchievements,
      totalPlaytime: Number((totalPlaytime / 60).toFixed(1)),
      perfectGames,
    }

    await setJson(key, stats, STATS_CACHE_TTL_SECONDS)

    return stats
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
