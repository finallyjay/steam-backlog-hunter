import "server-only"

import { buildCacheKey, getJson, setJson } from "@/lib/server/cache"
import {
  getGameSchema,
  getOwnedGames,
  getPlayerAchievements,
  getRecentlyPlayedGames,
  type GameAchievements,
  type SteamGame,
} from "@/lib/steam-api"
import type { SteamAchievementView } from "@/lib/types/steam"

const GAMES_CACHE_TTL_SECONDS = 10 * 60
const ACHIEVEMENTS_CACHE_TTL_SECONDS = 10 * 60
const SCHEMA_CACHE_TTL_SECONDS = 10 * 60

type SchemaAchievement = {
  name: string
  displayName?: string
  description?: string
  icon?: string
  icongray?: string
}

type GameSchema = {
  availableGameStats?: {
    achievements?: SchemaAchievement[]
  }
}

type EnrichedAchievements = Omit<GameAchievements, "achievements"> & {
  achievements: SteamAchievementView[]
}

async function readThroughCache<T>(options: {
  key: string
  ttlSeconds: number
  forceRefresh?: boolean
  loader: () => Promise<T>
}): Promise<T> {
  if (!options.forceRefresh) {
    const cached = await getJson<T>(options.key)
    if (cached !== null) {
      return cached
    }
  }

  const fresh = await options.loader()
  await setJson(options.key, fresh, options.ttlSeconds)
  return fresh
}

export async function getOwnedGamesCached(steamId: string, options?: { forceRefresh?: boolean }) {
  const key = buildCacheKey(["games", steamId, "all"])
  return readThroughCache<SteamGame[]>({
    key,
    ttlSeconds: GAMES_CACHE_TTL_SECONDS,
    forceRefresh: options?.forceRefresh,
    loader: () => getOwnedGames(steamId),
  })
}

export async function getRecentlyPlayedGamesCached(steamId: string, options?: { forceRefresh?: boolean }) {
  const key = buildCacheKey(["games", steamId, "recent"])
  return readThroughCache<SteamGame[]>({
    key,
    ttlSeconds: GAMES_CACHE_TTL_SECONDS,
    forceRefresh: options?.forceRefresh,
    loader: () => getRecentlyPlayedGames(steamId),
  })
}

async function getGameSchemaCached(appId: number, options?: { forceRefresh?: boolean }) {
  const key = buildCacheKey(["schema", String(appId)])

  return readThroughCache<GameSchema | null>({
    key,
    ttlSeconds: SCHEMA_CACHE_TTL_SECONDS,
    forceRefresh: options?.forceRefresh,
    loader: async () => (await getGameSchema(appId)) as GameSchema | null,
  })
}

export async function getEnrichedPlayerAchievementsCached(
  steamId: string,
  appId: number,
  options?: { forceRefresh?: boolean },
): Promise<EnrichedAchievements | null> {
  const achievements = await getPlayerAchievementsCached(steamId, appId, options)
  if (!achievements) {
    return null
  }

  const schema = await getGameSchemaCached(appId, options)

  const enrichedAchievements: SteamAchievementView[] = achievements.achievements.map((achievement) => {
    const schemaAchievement = schema?.availableGameStats?.achievements?.find(
      (schemaItem: SchemaAchievement) => schemaItem.name === achievement.apiname,
    )

    return {
      ...achievement,
      displayName: schemaAchievement?.displayName || achievement.name || achievement.apiname,
      description: schemaAchievement?.description || achievement.description || "",
      icon: schemaAchievement?.icon || "",
      icongray: schemaAchievement?.icongray || "",
    }
  })

  return {
    ...achievements,
    achievements: enrichedAchievements,
  }
}

export async function getPlayerAchievementsCached(
  steamId: string,
  appId: number,
  options?: { forceRefresh?: boolean },
): Promise<GameAchievements | null> {
  const key = buildCacheKey(["ach", steamId, String(appId)])

  return readThroughCache<GameAchievements | null>({
    key,
    ttlSeconds: ACHIEVEMENTS_CACHE_TTL_SECONDS,
    forceRefresh: options?.forceRefresh,
    loader: () => getPlayerAchievements(steamId, appId),
  })
}
