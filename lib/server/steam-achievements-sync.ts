import "server-only"

import { getGameSchema, getPlayerAchievements } from "@/lib/steam-api"
import type { SteamAchievementView } from "@/lib/types/steam"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { nowIso, isStale, parseJson } from "@/lib/server/steam-store-utils"
import { ensureOwnedGamesSynced, getStoredGame } from "@/lib/server/steam-games-sync"

const ACHIEVEMENTS_STALE_MS = 7 * 24 * 60 * 60 * 1000
const SCHEMA_STALE_MS = 30 * 24 * 60 * 60 * 1000

export { ACHIEVEMENTS_STALE_MS }

type UserAchievementRow = {
  achievements_json: string | null
  achievements_synced_at: string | null
  unlocked_count: number | null
  total_count: number | null
  perfect_game: number | null
}

type SchemaRow = {
  schema_json: string | null
  schema_synced_at: string | null
}

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

/** Retrieves stored achievement data for a single game from SQLite. */
export function getStoredAchievements(steamId: string, appId: number) {
  const db = getSqliteDatabase()
  return db
    .prepare(
      `
    SELECT achievements_json, achievements_synced_at, unlocked_count, total_count, perfect_game
    FROM user_games
    WHERE steam_id = ? AND appid = ? AND owned = 1
  `,
    )
    .get(steamId, appId) as UserAchievementRow | undefined
}

/**
 * Retrieves stored achievements for multiple games in a single query.
 *
 * @returns A map of app ID to achievement views
 */
export function getBatchStoredAchievements(steamId: string, appIds: number[]): Record<number, SteamAchievementView[]> {
  if (appIds.length === 0) return {}

  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
    SELECT appid, achievements_json
    FROM user_games
    WHERE steam_id = ? AND owned = 1 AND achievements_json IS NOT NULL
      AND appid IN (${appIds.map(() => "?").join(",")})
  `,
    )
    .all(steamId, ...appIds) as Array<{ appid: number; achievements_json: string }>

  const result: Record<number, SteamAchievementView[]> = {}
  for (const row of rows) {
    const parsed = parseJson<SteamAchievementView[]>(row.achievements_json)
    if (parsed) {
      result[row.appid] = parsed
    }
  }
  return result
}

/** Saves achievement data to SQLite, computing unlocked/total counts and perfect game status. */
export function persistAchievements(steamId: string, appId: number, achievements: SteamAchievementView[]) {
  const db = getSqliteDatabase()
  const now = nowIso()
  const unlockedCount = achievements.filter((achievement) => achievement.achieved === 1).length
  const totalCount = achievements.length
  const perfectGame = totalCount > 0 && unlockedCount === totalCount ? 1 : 0

  db.prepare(
    `
    UPDATE user_games
    SET
      achievements_json = ?,
      achievements_synced_at = ?,
      unlocked_count = ?,
      total_count = ?,
      perfect_game = ?,
      updated_at = ?
    WHERE steam_id = ? AND appid = ? AND owned = 1
  `,
  ).run(JSON.stringify(achievements), now, unlockedCount, totalCount, perfectGame, now, steamId, appId)
}

function persistSchema(appId: number, schema: GameSchema | null) {
  const db = getSqliteDatabase()
  const now = nowIso()
  db.prepare(
    `
    UPDATE games
    SET schema_json = ?, schema_synced_at = ?, updated_at = ?
    WHERE appid = ?
  `,
  ).run(schema ? JSON.stringify(schema) : null, now, now, appId)
}

/** Retrieves the stored game schema (achievement definitions) from SQLite. */
export function getStoredSchema(appId: number) {
  const db = getSqliteDatabase()
  return db
    .prepare(
      `
    SELECT schema_json, schema_synced_at
    FROM games
    WHERE appid = ?
  `,
    )
    .get(appId) as SchemaRow | undefined
}

/** Ensures the game schema is synced, fetching from Steam API if stale or missing. */
export async function ensureSchema(steamId: string, appId: number, options?: { forceRefresh?: boolean }) {
  const forceRefresh = options?.forceRefresh ?? false
  const storedSchema = getStoredSchema(appId)

  if (!forceRefresh && storedSchema && !isStale(storedSchema.schema_synced_at, SCHEMA_STALE_MS)) {
    return parseJson<GameSchema>(storedSchema.schema_json)
  }

  const schema = (await getGameSchema(appId)) as GameSchema | null
  persistSchema(appId, schema)
  return schema
}

/** Enriches raw player achievements with display names, descriptions, and icons from the game schema. */
export function buildAchievementsView(
  rawAchievements: NonNullable<Awaited<ReturnType<typeof getPlayerAchievements>>>["achievements"],
  schema: GameSchema | null,
): SteamAchievementView[] {
  return rawAchievements.map((achievement) => {
    const schemaAchievement = schema?.availableGameStats?.achievements?.find(
      (schemaItem) => schemaItem.name === achievement.apiname,
    )

    return {
      ...achievement,
      displayName: schemaAchievement?.displayName || achievement.name || achievement.apiname,
      description: schemaAchievement?.description || achievement.description || "",
      icon: schemaAchievement?.icon || "",
      icongray: schemaAchievement?.icongray || "",
    }
  })
}

/**
 * Returns enriched achievements for a game, fetching from Steam API if stale.
 *
 * @returns Achievement data with schema-enriched views, or null if the game is not owned or has no achievements
 */
export async function getAchievementsForGame(steamId: string, appId: number, options?: { forceRefresh?: boolean }) {
  await ensureOwnedGamesSynced(steamId)

  const game = getStoredGame(steamId, appId)
  if (!game) {
    return null
  }

  const forceRefresh = options?.forceRefresh ?? false
  const storedAchievements = getStoredAchievements(steamId, appId)

  if (
    !forceRefresh &&
    storedAchievements &&
    !isStale(storedAchievements.achievements_synced_at, ACHIEVEMENTS_STALE_MS)
  ) {
    const parsed = parseJson<SteamAchievementView[]>(storedAchievements.achievements_json)
    if (parsed) {
      return {
        steamID: steamId,
        gameName: game.name,
        achievements: parsed,
        success: true,
      }
    }
  }

  const [playerAchievements, schema] = await Promise.all([
    getPlayerAchievements(steamId, appId),
    ensureSchema(steamId, appId, options),
  ])

  if (!playerAchievements) {
    // Mark as checked with 0 achievements so we don't retry broken/retired games
    persistAchievements(steamId, appId, [])
    return null
  }

  const enrichedAchievements = buildAchievementsView(playerAchievements.achievements, schema)
  persistAchievements(steamId, appId, enrichedAchievements)

  return {
    steamID: playerAchievements.steamID,
    gameName: playerAchievements.gameName,
    achievements: enrichedAchievements,
    success: playerAchievements.success,
  }
}
