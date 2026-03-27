import "server-only"

import { getGameSchema, getOwnedGames, getPlayerAchievements, type SteamGame } from "@/lib/steam-api"
import { ensureGameImages } from "@/lib/server/steam-images"
import { getTrackedGameIdsServer } from "@/lib/server/tracked-games"
import type { SteamAchievementView, SteamStatsResponse } from "@/lib/types/steam"
import { getSqliteDatabase } from "@/lib/server/sqlite"

const OWNED_GAMES_STALE_MS = 24 * 60 * 60 * 1000
const ACHIEVEMENTS_STALE_MS = 7 * 24 * 60 * 60 * 1000
const SCHEMA_STALE_MS = 30 * 24 * 60 * 60 * 1000
const STATS_STALE_MS = 15 * 60 * 1000
const ACHIEVEMENTS_CONCURRENCY = 8
type NullableStringRecord = Record<string, string | null | undefined>

type GameRow = {
  appid: number
  name: string
  playtime_forever: number
  playtime_2weeks: number | null
  rtime_last_played: number | null
  img_icon_url: string | null
  img_logo_url: string | null
  image_icon_url: string | null
  image_landscape_url: string | null
  image_portrait_url: string | null
  has_community_visible_stats: number | null
}

type StatsSnapshotRow = {
  total_games: number
  total_achievements: number
  pending_achievements: number
  started_games: number
  library_average_completion: number
  total_playtime_minutes: number
  perfect_games: number
  computed_at: string
}

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

function nowIso() {
  return new Date().toISOString()
}

function nullIfUndefined<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

function parseIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function isStale(value: string | null | undefined, maxAgeMs: number) {
  const timestamp = parseIsoTimestamp(value)
  if (timestamp === null) {
    return true
  }

  return Date.now() - timestamp > maxAgeMs
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function markGameAsTracked(appId: number, source: "seed" | "discovered" | "manual" = "discovered") {
  const db = getSqliteDatabase()
  const now = nowIso()

  db.prepare(`
    INSERT INTO tracked_games (appid, source, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      updated_at = excluded.updated_at
  `).run(appId, source, now, now)
}

function upsertProfile(steamId: string) {
  const db = getSqliteDatabase()
  const now = nowIso()

  db.prepare(`
    INSERT INTO steam_profile (
      steam_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(steam_id) DO UPDATE SET
      updated_at = excluded.updated_at
  `).run(steamId, now, now)
}

function markProfileSync(steamId: string, column: "last_owned_games_sync_at" | "last_recent_games_sync_at", value: string) {
  const db = getSqliteDatabase()
  db.prepare(`
    UPDATE steam_profile
    SET ${column} = ?, updated_at = ?
    WHERE steam_id = ?
  `).run(value, value, steamId)
}

function getProfileSync(steamId: string) {
  const db = getSqliteDatabase()
  return db.prepare(`
    SELECT last_owned_games_sync_at, last_recent_games_sync_at
    FROM steam_profile
    WHERE steam_id = ?
  `).get(steamId) as NullableStringRecord | undefined
}

export function getUserSyncStatus(steamId: string) {
  upsertProfile(steamId)
  const profileSync = getProfileSync(steamId)
  const statsSnapshot = getStoredStatsSnapshot(steamId)

  return {
    lastOwnedGamesSyncAt: profileSync?.last_owned_games_sync_at ?? null,
    lastRecentGamesSyncAt: profileSync?.last_recent_games_sync_at ?? null,
    lastStatsSyncAt: statsSnapshot?.computed_at ?? null,
  }
}

function mapRowToSteamGame(row: GameRow): SteamGame {
  return {
    appid: row.appid,
    name: row.name,
    playtime_forever: row.playtime_forever,
    playtime_2weeks: row.playtime_2weeks ?? undefined,
    rtime_last_played: row.rtime_last_played ?? undefined,
    img_icon_url: row.img_icon_url ?? "",
    img_logo_url: row.img_logo_url ?? "",
    image_icon_url: row.image_icon_url ?? undefined,
    image_landscape_url: row.image_landscape_url ?? undefined,
    image_portrait_url: row.image_portrait_url ?? undefined,
    has_community_visible_stats: row.has_community_visible_stats === null
      ? undefined
      : row.has_community_visible_stats === 1,
  }
}

function getStoredOwnedGames(steamId: string): SteamGame[] {
  const db = getSqliteDatabase()
  const rows = db.prepare(`
    SELECT
      ug.appid,
      g.name,
      ug.playtime_forever,
      ug.playtime_2weeks,
      ug.rtime_last_played,
      g.icon_hash AS img_icon_url,
      g.logo_hash AS img_logo_url,
      g.image_icon_url,
      g.image_landscape_url,
      g.image_portrait_url,
      g.has_community_visible_stats
    FROM user_games ug
    INNER JOIN games g ON g.appid = ug.appid
    WHERE ug.steam_id = ? AND ug.owned = 1
    ORDER BY LOWER(g.name) ASC
  `).all(steamId) as GameRow[]

  return rows.map(mapRowToSteamGame)
}

function getStoredGame(steamId: string, appId: number): SteamGame | null {
  const db = getSqliteDatabase()
  const row = db.prepare(`
    SELECT
      ug.appid,
      g.name,
      ug.playtime_forever,
      ug.playtime_2weeks,
      ug.rtime_last_played,
      g.icon_hash AS img_icon_url,
      g.logo_hash AS img_logo_url,
      g.image_icon_url,
      g.image_landscape_url,
      g.image_portrait_url,
      g.has_community_visible_stats
    FROM user_games ug
    INNER JOIN games g ON g.appid = ug.appid
    WHERE ug.steam_id = ? AND ug.appid = ? AND ug.owned = 1
  `).get(steamId, appId) as GameRow | undefined

  return row ? mapRowToSteamGame(row) : null
}

function persistOwnedGames(steamId: string, games: SteamGame[]) {
  const db = getSqliteDatabase()
  const now = nowIso()
  upsertProfile(steamId)

  const insertGame = db.prepare(`
    INSERT INTO games (
      appid,
      name,
      icon_hash,
      logo_hash,
      has_community_visible_stats,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      name = excluded.name,
      icon_hash = excluded.icon_hash,
      logo_hash = excluded.logo_hash,
      has_community_visible_stats = excluded.has_community_visible_stats,
      updated_at = excluded.updated_at
  `)

  const insertUserGame = db.prepare(`
    INSERT INTO user_games (
      steam_id,
      appid,
      playtime_forever,
      playtime_2weeks,
      rtime_last_played,
      owned,
      last_seen_in_owned_games_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(steam_id, appid) DO UPDATE SET
      playtime_forever = excluded.playtime_forever,
      playtime_2weeks = excluded.playtime_2weeks,
      rtime_last_played = excluded.rtime_last_played,
      owned = 1,
      last_seen_in_owned_games_at = excluded.last_seen_in_owned_games_at,
      updated_at = excluded.updated_at
  `)

  const markMissingAsUnowned = db.prepare(`
    UPDATE user_games
    SET owned = 0, updated_at = ?
    WHERE steam_id = ?
  `)

  db.exec("BEGIN")

  try {
    markMissingAsUnowned.run(now, steamId)

    for (const game of games) {
      insertGame.run(
        game.appid,
        game.name,
        nullIfUndefined(game.img_icon_url),
        nullIfUndefined(game.img_logo_url),
        typeof game.has_community_visible_stats === "boolean" ? Number(game.has_community_visible_stats) : null,
        now,
        now,
      )

      insertUserGame.run(
        steamId,
        game.appid,
        game.playtime_forever,
        nullIfUndefined(game.playtime_2weeks),
        nullIfUndefined(game.rtime_last_played),
        now,
        now,
        now,
      )
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }

  markProfileSync(steamId, "last_owned_games_sync_at", now)
}

function getStoredAchievements(steamId: string, appId: number) {
  const db = getSqliteDatabase()
  return db.prepare(`
    SELECT achievements_json, achievements_synced_at, unlocked_count, total_count, perfect_game
    FROM user_games
    WHERE steam_id = ? AND appid = ? AND owned = 1
  `).get(steamId, appId) as UserAchievementRow | undefined
}

export function getBatchStoredAchievements(steamId: string, appIds: number[]): Record<number, SteamAchievementView[]> {
  if (appIds.length === 0) return {}

  const db = getSqliteDatabase()
  const rows = db.prepare(`
    SELECT appid, achievements_json
    FROM user_games
    WHERE steam_id = ? AND owned = 1 AND achievements_json IS NOT NULL
      AND appid IN (${appIds.map(() => "?").join(",")})
  `).all(steamId, ...appIds) as Array<{ appid: number; achievements_json: string }>

  const result: Record<number, SteamAchievementView[]> = {}
  for (const row of rows) {
    const parsed = parseJson<SteamAchievementView[]>(row.achievements_json)
    if (parsed) {
      result[row.appid] = parsed
    }
  }
  return result
}

function persistSchema(appId: number, schema: GameSchema | null) {
  const db = getSqliteDatabase()
  const now = nowIso()
  db.prepare(`
    UPDATE games
    SET schema_json = ?, schema_synced_at = ?, updated_at = ?
    WHERE appid = ?
  `).run(schema ? JSON.stringify(schema) : null, now, now, appId)

  if (schema?.availableGameStats?.achievements?.length) {
    markGameAsTracked(appId, "discovered")
  }
}

function getStoredSchema(appId: number) {
  const db = getSqliteDatabase()
  return db.prepare(`
    SELECT schema_json, schema_synced_at
    FROM games
    WHERE appid = ?
  `).get(appId) as SchemaRow | undefined
}

function persistAchievements(steamId: string, appId: number, achievements: SteamAchievementView[]) {
  const db = getSqliteDatabase()
  const now = nowIso()
  const unlockedCount = achievements.filter((achievement) => achievement.achieved === 1).length
  const totalCount = achievements.length
  const perfectGame = totalCount > 0 && unlockedCount === totalCount ? 1 : 0

  db.prepare(`
    UPDATE user_games
    SET
      achievements_json = ?,
      achievements_synced_at = ?,
      unlocked_count = ?,
      total_count = ?,
      perfect_game = ?,
      updated_at = ?
    WHERE steam_id = ? AND appid = ? AND owned = 1
  `).run(
    JSON.stringify(achievements),
    now,
    unlockedCount,
    totalCount,
    perfectGame,
    now,
    steamId,
    appId,
  )
}

function persistStatsSnapshot(steamId: string, stats: SteamStatsResponse) {
  const db = getSqliteDatabase()
  const now = nowIso()
  db.prepare(`
    INSERT INTO stats_snapshot (
      steam_id,
      total_games,
      total_achievements,
      pending_achievements,
      started_games,
      library_average_completion,
      total_playtime_minutes,
      perfect_games,
      computed_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(steam_id) DO UPDATE SET
      total_games = excluded.total_games,
      total_achievements = excluded.total_achievements,
      pending_achievements = excluded.pending_achievements,
      started_games = excluded.started_games,
      library_average_completion = excluded.library_average_completion,
      total_playtime_minutes = excluded.total_playtime_minutes,
      perfect_games = excluded.perfect_games,
      computed_at = excluded.computed_at,
      updated_at = excluded.updated_at
  `).run(
    steamId,
    stats.totalGames,
    stats.totalAchievements,
    stats.pendingAchievements,
    stats.startedGames,
    stats.averageCompletion,
    Math.round(stats.totalPlaytime * 60),
    stats.perfectGames,
    now,
    now,
  )
}

function getStoredStatsSnapshot(steamId: string) {
  const db = getSqliteDatabase()
  return db.prepare(`
    SELECT total_games, total_achievements, pending_achievements, started_games, library_average_completion, total_playtime_minutes, perfect_games, computed_at
    FROM stats_snapshot
    WHERE steam_id = ?
  `).get(steamId) as StatsSnapshotRow | undefined
}

function buildAchievementsView(
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

async function ensureOwnedGamesSynced(steamId: string, options?: { forceRefresh?: boolean }) {
  const forceRefresh = options?.forceRefresh ?? false
  upsertProfile(steamId)

  const syncInfo = getProfileSync(steamId)
  const shouldRefresh = forceRefresh || isStale(syncInfo?.last_owned_games_sync_at, OWNED_GAMES_STALE_MS)
  const existingGames = getStoredOwnedGames(steamId)

  if (!shouldRefresh && existingGames.length > 0) {
    await ensureGameImages(existingGames.map((game) => game.appid))
    return existingGames
  }

  const games = await getOwnedGames(steamId)
  persistOwnedGames(steamId, games)
  await ensureGameImages(games.map((game) => game.appid))
  return getStoredOwnedGames(steamId)
}

export async function getOwnedGamesForUser(steamId: string, options?: { forceRefresh?: boolean }) {
  return ensureOwnedGamesSynced(steamId, options)
}

export async function getRecentlyPlayedGamesForUser(steamId: string, options?: { forceRefresh?: boolean }) {
  await ensureOwnedGamesSynced(steamId, options)

  const db = getSqliteDatabase()
  const rows = db.prepare(`
    SELECT
      ug.appid,
      g.name,
      ug.playtime_forever,
      ug.playtime_2weeks,
      ug.rtime_last_played,
      g.icon_hash AS img_icon_url,
      g.logo_hash AS img_logo_url,
      g.image_icon_url,
      g.image_landscape_url,
      g.image_portrait_url,
      g.has_community_visible_stats
    FROM user_games ug
    INNER JOIN games g ON g.appid = ug.appid
    WHERE ug.steam_id = ? AND ug.owned = 1 AND ug.rtime_last_played > 0
    ORDER BY ug.rtime_last_played DESC
    LIMIT 25
  `).all(steamId) as GameRow[]

  return rows.map(mapRowToSteamGame)
}

export async function getStoredGameForUser(steamId: string, appId: number, options?: { forceRefresh?: boolean }) {
  await ensureOwnedGamesSynced(steamId, options)
  return getStoredGame(steamId, appId)
}

async function ensureSchema(appId: number, options?: { forceRefresh?: boolean }) {
  const forceRefresh = options?.forceRefresh ?? false
  const storedSchema = getStoredSchema(appId)

  if (!forceRefresh && storedSchema && !isStale(storedSchema.schema_synced_at, SCHEMA_STALE_MS)) {
    return parseJson<GameSchema>(storedSchema.schema_json)
  }

  const schema = (await getGameSchema(appId)) as GameSchema | null
  persistSchema(appId, schema)
  return schema
}

export async function getAchievementsForGame(
  steamId: string,
  appId: number,
  options?: { forceRefresh?: boolean },
) {
  await ensureOwnedGamesSynced(steamId)

  const game = getStoredGame(steamId, appId)
  if (!game) {
    return null
  }

  const forceRefresh = options?.forceRefresh ?? false
  const storedAchievements = getStoredAchievements(steamId, appId)

  if (!forceRefresh && storedAchievements && !isStale(storedAchievements.achievements_synced_at, ACHIEVEMENTS_STALE_MS)) {
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
    ensureSchema(appId, options),
  ])

  if (!playerAchievements) {
    return null
  }

  const enrichedAchievements = buildAchievementsView(playerAchievements.achievements, schema)
  persistAchievements(steamId, appId, enrichedAchievements)
  if (enrichedAchievements.length > 0) {
    markGameAsTracked(appId, "discovered")
  }

  return {
    steamID: playerAchievements.steamID,
    gameName: playerAchievements.gameName,
    achievements: enrichedAchievements,
    success: playerAchievements.success,
  }
}

function roundPercent(value: number) {
  return Math.floor(value)
}

function computeStatsFromDatabase(steamId: string, allowedIds: Set<string>): SteamStatsResponse {
  const db = getSqliteDatabase()
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total_games,
      COALESCE(SUM(playtime_forever), 0) AS total_playtime_minutes
    FROM user_games
    WHERE steam_id = ? AND owned = 1
  `).get(steamId) as { total_games: number; total_playtime_minutes: number }

  const allowedAppIds = Array.from(allowedIds).map((id) => Number(id))
  const achievementTotals = allowedAppIds.length > 0
    ? db.prepare(`
        SELECT
          COALESCE(SUM(unlocked_count), 0) AS total_achievements,
          COALESCE(SUM(CASE WHEN total_count > unlocked_count THEN total_count - unlocked_count ELSE 0 END), 0) AS pending_achievements,
          COALESCE(SUM(CASE WHEN unlocked_count > 0 THEN 1 ELSE 0 END), 0) AS started_games,
          COALESCE(SUM(perfect_game), 0) AS perfect_games
        FROM user_games
        WHERE steam_id = ? AND owned = 1 AND appid IN (${allowedAppIds.map(() => "?").join(",")})
      `).get(steamId, ...allowedAppIds) as {
        total_achievements: number
        pending_achievements: number
        started_games: number
        perfect_games: number
      }
    : {
        total_achievements: 0,
        pending_achievements: 0,
        started_games: 0,
        perfect_games: 0,
      }

  const libraryAverageRow = db.prepare(`
    SELECT AVG(CAST(unlocked_count AS REAL) / total_count) * 100 AS average_completion
    FROM user_games
    WHERE steam_id = ? AND owned = 1 AND total_count > 0 AND unlocked_count > 0
  `).get(steamId) as { average_completion: number | null }

  return {
    totalGames: totals.total_games ?? 0,
    totalAchievements: achievementTotals.total_achievements ?? 0,
    pendingAchievements: achievementTotals.pending_achievements ?? 0,
    startedGames: achievementTotals.started_games ?? 0,
    averageCompletion: roundPercent(libraryAverageRow.average_completion ?? 0),
    totalPlaytime: Number(((totals.total_playtime_minutes ?? 0) / 60).toFixed(1)),
    perfectGames: achievementTotals.perfect_games ?? 0,
  }
}

async function syncAchievementsForStats(steamId: string, forceRefresh: boolean) {
  const allowedIds = await getTrackedGameIdsServer()
  const ownedGames = await ensureOwnedGamesSynced(steamId, { forceRefresh })
  const candidateGames = ownedGames.filter((game) => allowedIds.has(String(game.appid)))

  for (let index = 0; index < candidateGames.length; index += ACHIEVEMENTS_CONCURRENCY) {
    const chunk = candidateGames.slice(index, index + ACHIEVEMENTS_CONCURRENCY)
    await Promise.allSettled(
      chunk.map(async (game) => {
        const storedAchievements = getStoredAchievements(steamId, game.appid)
        if (!forceRefresh && storedAchievements && !isStale(storedAchievements.achievements_synced_at, ACHIEVEMENTS_STALE_MS)) {
          return
        }

        await getAchievementsForGame(steamId, game.appid, { forceRefresh })
      }),
    )
  }

  return allowedIds
}

export async function getStatsForUser(steamId: string, options?: { forceRefresh?: boolean }) {
  const forceRefresh = options?.forceRefresh ?? false
  await ensureOwnedGamesSynced(steamId, { forceRefresh })

  const snapshot = getStoredStatsSnapshot(steamId)
  if (!forceRefresh && snapshot && !isStale(snapshot.computed_at, STATS_STALE_MS)) {
    return {
      totalGames: snapshot.total_games,
      totalAchievements: snapshot.total_achievements,
      pendingAchievements: snapshot.pending_achievements,
      startedGames: snapshot.started_games,
      averageCompletion: snapshot.library_average_completion,
      totalPlaytime: Number((snapshot.total_playtime_minutes / 60).toFixed(1)),
      perfectGames: snapshot.perfect_games,
    }
  }

  const allowedIds = await syncAchievementsForStats(steamId, forceRefresh)
  const stats = computeStatsFromDatabase(steamId, allowedIds)
  persistStatsSnapshot(steamId, stats)

  return stats
}

export async function synchronizeUserData(steamId: string) {
  const ownedGames = await ensureOwnedGamesSynced(steamId, { forceRefresh: true })
  const recentGames = await getRecentlyPlayedGamesForUser(steamId, { forceRefresh: true })
  const stats = await getStatsForUser(steamId, { forceRefresh: true })

  return {
    syncedAt: new Date().toISOString(),
    ownedGames: ownedGames.length,
    recentGames: recentGames.length,
    stats,
  }
}
