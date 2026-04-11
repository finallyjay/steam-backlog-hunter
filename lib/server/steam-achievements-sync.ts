import "server-only"

import { getGameSchema, getPlayerAchievements, type SteamAchievement } from "@/lib/steam-api"
import type { SteamAchievementView } from "@/lib/types/steam"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { nowIso, isStale } from "@/lib/server/steam-store-utils"
import { ensureOwnedGamesSynced, getStoredGame } from "@/lib/server/steam-games-sync"

const ACHIEVEMENTS_STALE_MS = 7 * 24 * 60 * 60 * 1000
const SCHEMA_STALE_MS = 30 * 24 * 60 * 60 * 1000

export { ACHIEVEMENTS_STALE_MS }

type UserAchievementMetaRow = {
  achievements_synced_at: string | null
  unlocked_count: number | null
  total_count: number | null
  perfect_game: number | null
}

type AchievementJoinRow = {
  appid: number
  apiname: string
  display_name: string | null
  description: string | null
  icon: string | null
  icon_gray: string | null
  achieved: number
  unlock_time: number | null
}

function mapJoinRowToView(row: AchievementJoinRow): SteamAchievementView {
  return {
    apiname: row.apiname,
    achieved: row.achieved,
    unlocktime: row.unlock_time ?? 0,
    name: row.display_name ?? row.apiname,
    description: row.description ?? "",
    displayName: row.display_name ?? row.apiname,
    icon: row.icon ?? "",
    icongray: row.icon_gray ?? "",
  }
}

type SchemaAchievement = {
  name: string
  displayName?: string
  description?: string
  icon?: string
  icongray?: string
  hidden?: number
}

type GameSchema = {
  availableGameStats?: {
    achievements?: SchemaAchievement[]
  }
}

/** Retrieves stored achievement sync metadata (counts, timestamp, perfect flag) for a single game. */
export function getStoredAchievements(steamId: string, appId: number) {
  const db = getSqliteDatabase()
  return db
    .prepare(
      `
    SELECT achievements_synced_at, unlocked_count, total_count, perfect_game
    FROM user_games
    WHERE steam_id = ? AND appid = ? AND owned = 1
  `,
    )
    .get(steamId, appId) as UserAchievementMetaRow | undefined
}

/**
 * Reads a single game's enriched achievements from the normalized tables.
 *
 * Returns the full achievement list (including locked entries) by joining
 * `game_achievements` with `user_achievements`, or `null` if the game has
 * never been synced or has no achievements defined in its schema.
 */
export function readStoredAchievementsList(steamId: string, appId: number): SteamAchievementView[] | null {
  const db = getSqliteDatabase()
  const meta = db
    .prepare(
      `SELECT achievements_synced_at FROM user_games
       WHERE steam_id = ? AND appid = ? AND owned = 1`,
    )
    .get(steamId, appId) as { achievements_synced_at: string | null } | undefined

  if (!meta?.achievements_synced_at) return null

  const rows = db
    .prepare(
      `
      SELECT
        ga.appid,
        ga.apiname,
        ga.display_name,
        ga.description,
        ga.icon,
        ga.icon_gray,
        COALESCE(ua.achieved, 0) AS achieved,
        COALESCE(ua.unlock_time, 0) AS unlock_time
      FROM game_achievements ga
      LEFT JOIN user_achievements ua
        ON ua.appid = ga.appid
        AND ua.apiname = ga.apiname
        AND ua.steam_id = ?
      WHERE ga.appid = ?
      ORDER BY ga.apiname
    `,
    )
    .all(steamId, appId) as AchievementJoinRow[]

  if (rows.length === 0) return null
  return rows.map(mapJoinRowToView)
}

/**
 * Retrieves stored achievements for multiple games in a single JOIN query.
 *
 * Filters to games the user has already synced (`achievements_synced_at IS NOT NULL`)
 * so that unsynced games are absent from the result rather than appearing as all-locked.
 *
 * @returns A map of app ID to achievement views
 */
export function getBatchStoredAchievements(steamId: string, appIds: number[]): Record<number, SteamAchievementView[]> {
  if (appIds.length === 0) return {}

  const db = getSqliteDatabase()
  const placeholders = appIds.map(() => "?").join(",")
  const rows = db
    .prepare(
      `
      SELECT
        ga.appid,
        ga.apiname,
        ga.display_name,
        ga.description,
        ga.icon,
        ga.icon_gray,
        COALESCE(ua.achieved, 0) AS achieved,
        COALESCE(ua.unlock_time, 0) AS unlock_time
      FROM user_games ug
      JOIN game_achievements ga ON ga.appid = ug.appid
      LEFT JOIN user_achievements ua
        ON ua.appid = ga.appid
        AND ua.apiname = ga.apiname
        AND ua.steam_id = ug.steam_id
      WHERE ug.steam_id = ?
        AND ug.owned = 1
        AND ug.achievements_synced_at IS NOT NULL
        AND ug.appid IN (${placeholders})
      ORDER BY ga.appid, ga.apiname
    `,
    )
    .all(steamId, ...appIds) as AchievementJoinRow[]

  const result: Record<number, SteamAchievementView[]> = {}
  for (const row of rows) {
    const list = result[row.appid] ?? (result[row.appid] = [])
    list.push(mapJoinRowToView(row))
  }
  return result
}

/**
 * Persists the result of a per-game `GetPlayerAchievements` call.
 *
 * Writes `user_games` metadata (counts, sync timestamp, perfect flag) and
 * replaces the game's `user_achievements` rows with one row per **unlocked**
 * achievement (preserving `unlock_time`). Locked achievements are derived at
 * read time via the LEFT JOIN against `game_achievements`, so there's no
 * reason to materialise them.
 */
export function persistAchievements(steamId: string, appId: number, achievements: SteamAchievement[]) {
  const db = getSqliteDatabase()
  const now = nowIso()
  const unlockedCount = achievements.filter((achievement) => achievement.achieved === 1).length
  const totalCount = achievements.length
  const perfectGame = totalCount > 0 && unlockedCount === totalCount ? 1 : 0

  db.exec("BEGIN")
  try {
    db.prepare(
      `
      UPDATE user_games
      SET
        achievements_synced_at = ?,
        unlocked_count = ?,
        total_count = ?,
        perfect_game = ?,
        updated_at = ?
      WHERE steam_id = ? AND appid = ? AND owned = 1
    `,
    ).run(now, unlockedCount, totalCount, perfectGame, now, steamId, appId)

    db.prepare(`DELETE FROM user_achievements WHERE steam_id = ? AND appid = ?`).run(steamId, appId)

    const insert = db.prepare(`
      INSERT INTO user_achievements (
        steam_id, appid, apiname, achieved, unlock_time, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?)
    `)

    for (const achievement of achievements) {
      if (!achievement.apiname || achievement.achieved !== 1) continue
      insert.run(steamId, appId, achievement.apiname, achievement.unlocktime ?? null, now, now)
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

/**
 * Persists a bulk `GetTopAchievementsForGames` result for a single game.
 *
 * The bulk endpoint only returns **unlocked** achievements, so this function
 * writes the unlocked-count metadata onto `user_games` and replaces the
 * game's `user_achievements` rows with one row per unlocked apiname. Locked
 * achievements are not materialised — they're derived at read time via a
 * LEFT JOIN against `game_achievements`.
 *
 * Unlike `persistAchievements`, this function does not touch the legacy
 * `achievements_json` blob. That blob is only read as a safety net during
 * the dual-write period and is unused by the normalized read path.
 */
export function persistBulkGameStats(steamId: string, appId: number, totalCount: number, unlockedApinames: string[]) {
  const db = getSqliteDatabase()
  const now = nowIso()
  const unlockedCount = unlockedApinames.length
  const perfectGame = totalCount > 0 && unlockedCount === totalCount ? 1 : 0

  db.exec("BEGIN")
  try {
    db.prepare(
      `
      UPDATE user_games
      SET
        achievements_synced_at = ?,
        unlocked_count = ?,
        total_count = ?,
        perfect_game = ?,
        updated_at = ?
      WHERE steam_id = ? AND appid = ? AND owned = 1
    `,
    ).run(now, unlockedCount, totalCount, perfectGame, now, steamId, appId)

    db.prepare(`DELETE FROM user_achievements WHERE steam_id = ? AND appid = ?`).run(steamId, appId)

    if (unlockedCount > 0) {
      const insert = db.prepare(`
        INSERT INTO user_achievements (
          steam_id, appid, apiname, achieved, unlock_time, created_at, updated_at
        ) VALUES (?, ?, ?, 1, NULL, ?, ?)
      `)
      for (const apiname of unlockedApinames) {
        if (!apiname) continue
        insert.run(steamId, appId, apiname, now, now)
      }
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

/**
 * Persists the game schema (achievement definitions) into the normalized
 * `game_achievements` table. Callers that want to refresh must go through
 * `ensureSchema`, which handles staleness and upstream fetching.
 */
function persistSchema(appId: number, schema: GameSchema | null) {
  const db = getSqliteDatabase()
  const now = nowIso()

  db.exec("BEGIN")
  try {
    db.prepare(`UPDATE games SET schema_synced_at = ?, updated_at = ? WHERE appid = ?`).run(now, now, appId)

    const achievements = schema?.availableGameStats?.achievements ?? []
    if (achievements.length > 0) {
      const upsert = db.prepare(`
        INSERT INTO game_achievements (
          appid, apiname, display_name, description, icon, icon_gray, hidden, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(appid, apiname) DO UPDATE SET
          display_name = excluded.display_name,
          description = excluded.description,
          icon = excluded.icon,
          icon_gray = excluded.icon_gray,
          hidden = excluded.hidden,
          updated_at = excluded.updated_at
      `)

      for (const achievement of achievements) {
        if (!achievement.name) continue
        upsert.run(
          appId,
          achievement.name,
          achievement.displayName ?? null,
          achievement.description ?? null,
          achievement.icon ?? null,
          achievement.icongray ?? null,
          achievement.hidden ? 1 : 0,
          now,
          now,
        )
      }
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

/**
 * Ensures the game schema is synced, fetching from Steam API if stale or missing.
 *
 * Runs for its side effect on `game_achievements` — the return value is not
 * consumed by any caller, since read paths go through the normalized tables.
 */
export async function ensureSchema(appId: number, options?: { forceRefresh?: boolean }): Promise<void> {
  const forceRefresh = options?.forceRefresh ?? false
  const db = getSqliteDatabase()
  const row = db.prepare(`SELECT schema_synced_at FROM games WHERE appid = ?`).get(appId) as
    | { schema_synced_at: string | null }
    | undefined

  if (!forceRefresh && row?.schema_synced_at && !isStale(row.schema_synced_at, SCHEMA_STALE_MS)) {
    return
  }

  const schema = (await getGameSchema(appId)) as GameSchema | null
  persistSchema(appId, schema)
}

/**
 * Returns enriched achievements for a game, fetching from Steam API if stale.
 *
 * @returns Achievement data reconstructed from the normalized tables, or null
 *          if the game is not owned or is known to have no achievements
 */
export async function getAchievementsForGame(steamId: string, appId: number, options?: { forceRefresh?: boolean }) {
  await ensureOwnedGamesSynced(steamId)

  const game = getStoredGame(steamId, appId)
  if (!game) return null

  const forceRefresh = options?.forceRefresh ?? false
  const storedAchievements = getStoredAchievements(steamId, appId)

  if (
    !forceRefresh &&
    storedAchievements &&
    !isStale(storedAchievements.achievements_synced_at, ACHIEVEMENTS_STALE_MS)
  ) {
    // Known broken/retired game — metadata says "no achievements here". Don't
    // re-fetch on every request.
    if ((storedAchievements.total_count ?? 0) === 0) return null

    const cached = readStoredAchievementsList(steamId, appId)
    if (cached) {
      return {
        steamID: steamId,
        gameName: game.name,
        achievements: cached,
        success: true,
      }
    }
  }

  const [playerAchievements] = await Promise.all([getPlayerAchievements(steamId, appId), ensureSchema(appId, options)])

  if (!playerAchievements) {
    // Mark as checked with 0 achievements so we don't retry broken/retired games
    persistAchievements(steamId, appId, [])
    return null
  }

  persistAchievements(steamId, appId, playerAchievements.achievements)

  const achievements = readStoredAchievementsList(steamId, appId)
  return {
    steamID: playerAchievements.steamID,
    gameName: playerAchievements.gameName,
    achievements: achievements ?? [],
    success: playerAchievements.success,
  }
}
