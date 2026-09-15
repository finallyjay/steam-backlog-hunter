import "server-only"

import {
  getGameSchema,
  getGlobalAchievementPercentages,
  getPlayerAchievements,
  TransientSteamAPIError,
  type GameAchievements,
  type GameSchema,
  type GlobalAchievementPercent,
  type SteamAchievement,
} from "@/lib/steam-api"
import type { SteamAchievementView } from "@/lib/types/steam"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { nowIso, isStale } from "@/lib/server/steam-store-utils"
import { ensureOwnedGamesSynced, getStoredGame } from "@/lib/server/steam-games-sync"
import { diffApinames, recordAchievementChanges } from "@/lib/server/achievement-changes"

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
  hidden: number | null
  global_percent: number | null
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
    hidden: row.hidden ?? 0,
    globalPercent: row.global_percent,
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
        ga.hidden,
        ga.global_percent,
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
        ga.hidden,
        ga.global_percent,
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
  const unlockedByApiname = new Map<string, SteamAchievement>()
  for (const achievement of achievements) {
    if (!achievement.apiname || achievement.achieved !== 1) continue
    if (!unlockedByApiname.has(achievement.apiname)) {
      unlockedByApiname.set(achievement.apiname, achievement)
    }
  }
  const unlockedCount = unlockedByApiname.size
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

    for (const achievement of unlockedByApiname.values()) {
      insert.run(steamId, appId, achievement.apiname, achievement.unlocktime ?? null, now, now)
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
 *
 * `percentages` is the parallel `GetGlobalAchievementPercentagesForApp` result.
 * When provided, each apiname is joined by name and persisted alongside the
 * schema row. Pass `null` when the endpoint failed or returned nothing — we
 * still refresh the schema but leave `global_percent` as-is for rows we
 * already have (UPSERT only sets it when we have a value).
 *
 * Change detection: when we already had a non-empty schema stored *and*
 * Steam returned a non-empty one, the two apiname sets are diffed. Retired
 * apinames are deleted from `game_achievements` and `user_achievements`
 * (they would otherwise linger as permanently-locked ghosts), and one
 * `achievement_changes` row is written per owning user via
 * `recordAchievementChanges`. A `null`/empty schema is deliberately *not*
 * treated as "everything was removed": GetSchemaForGame returns nothing for
 * some delisted titles that still answer GetPlayerAchievements, and a
 * transient miss must not wipe good data.
 */
function persistSchema(appId: number, schema: GameSchema | null, percentages: GlobalAchievementPercent[] | null) {
  const db = getSqliteDatabase()
  const now = nowIso()

  const storedApinames = (
    db.prepare(`SELECT apiname FROM game_achievements WHERE appid = ?`).all(appId) as Array<{ apiname: string }>
  ).map((row) => row.apiname)

  const percentByName = new Map<string, number>()
  if (percentages) {
    for (const entry of percentages) {
      if (typeof entry.name === "string" && typeof entry.percent === "number") {
        percentByName.set(entry.name, entry.percent)
      }
    }
  }

  db.exec("BEGIN")
  try {
    db.prepare(`UPDATE games SET schema_synced_at = ?, updated_at = ? WHERE appid = ?`).run(now, now, appId)

    const achievements = schema?.availableGameStats?.achievements ?? []
    if (achievements.length > 0) {
      // Preserve an existing global_percent when the new percentages payload
      // didn't include this apiname — COALESCE against the existing column so
      // a transient rarity-endpoint miss doesn't null out good data.
      const upsert = db.prepare(`
        INSERT INTO game_achievements (
          appid, apiname, display_name, description, icon, icon_gray, hidden, global_percent, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(appid, apiname) DO UPDATE SET
          display_name = excluded.display_name,
          description = excluded.description,
          icon = excluded.icon,
          icon_gray = excluded.icon_gray,
          hidden = excluded.hidden,
          global_percent = COALESCE(excluded.global_percent, game_achievements.global_percent),
          updated_at = excluded.updated_at
      `)

      const incomingApinames: string[] = []
      for (const achievement of achievements) {
        if (!achievement.name) continue
        incomingApinames.push(achievement.name)
        upsert.run(
          appId,
          achievement.name,
          achievement.displayName ?? null,
          achievement.description ?? null,
          achievement.icon ?? null,
          achievement.icongray ?? null,
          achievement.hidden ? 1 : 0,
          percentByName.get(achievement.name) ?? null,
          now,
          now,
        )
      }

      if (storedApinames.length > 0 && incomingApinames.length > 0) {
        const { added, removed } = diffApinames(storedApinames, incomingApinames)
        if (removed.length > 0) {
          const placeholders = removed.map(() => "?").join(",")
          db.prepare(`DELETE FROM game_achievements WHERE appid = ? AND apiname IN (${placeholders})`).run(
            appId,
            ...removed,
          )
          db.prepare(`DELETE FROM user_achievements WHERE appid = ? AND apiname IN (${placeholders})`).run(
            appId,
            ...removed,
          )
        }
        recordAchievementChanges(appId, { added, removed, totalAfter: incomingApinames.length })
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
 * Runs for its side effect on `game_achievements`; read paths go through the
 * normalized tables.
 *
 * @returns `true` when Steam was actually queried in this call, `false` when
 *          the stored schema was fresh enough to skip. Callers use this to
 *          avoid re-fetching a schema that was refreshed moments ago.
 */
export async function ensureSchema(appId: number, options?: { forceRefresh?: boolean }): Promise<boolean> {
  const forceRefresh = options?.forceRefresh ?? false
  const db = getSqliteDatabase()
  const row = db.prepare(`SELECT schema_synced_at FROM games WHERE appid = ?`).get(appId) as
    | { schema_synced_at: string | null }
    | undefined

  if (!forceRefresh && row?.schema_synced_at && !isStale(row.schema_synced_at, SCHEMA_STALE_MS)) {
    return false
  }

  // Schema + global rarity in parallel. Rarity is an independent endpoint
  // (ISteamUserStats/GetGlobalAchievementPercentagesForApp) on the same
  // staleness budget as the schema, so refreshing them together keeps the
  // two data sets in sync without a second call cadence.
  const [schema, percentages] = await Promise.all([getGameSchema(appId), getGlobalAchievementPercentages(appId)])
  persistSchema(appId, schema, percentages)
  return true
}

/**
 * Returns true when the apinames Steam reports for the player differ from
 * the schema rows we have stored. Only meaningful once a schema exists
 * locally: with no stored rows there is nothing to compare against, and the
 * regular (or forced) `ensureSchema` path already handles first population.
 */
function isSchemaOutOfSync(appId: number, achievements: SteamAchievement[]): boolean {
  const db = getSqliteDatabase()
  const stored = (
    db.prepare(`SELECT apiname FROM game_achievements WHERE appid = ?`).all(appId) as Array<{ apiname: string }>
  ).map((row) => row.apiname)
  if (stored.length === 0) return false

  const incoming = achievements.map((a) => a.apiname).filter((name): name is string => Boolean(name))
  const { added, removed } = diffApinames(stored, incoming)
  return added.length > 0 || removed.length > 0
}

/**
 * Fetches a game's player achievements and schema from Steam and persists
 * both. Shared by the single-game path (`getAchievementsForGame`) and the
 * library-wide sync worker in `steam-stats-compute.ts`.
 *
 * Player progress and schema are fetched in parallel. If the player payload
 * then reveals apinames the stored schema doesn't know about (or vice
 * versa) and the schema was *not* just refreshed in this call, a forced
 * schema refresh runs before persisting. That closes the gap between the
 * 7-day progress cadence and the 30-day schema cadence: a game that gained
 * achievements gets its schema, counts and an `achievement_changes` row in
 * the same sync instead of up to a month later.
 *
 * Errors from the Steam client propagate unchanged so each caller keeps
 * its own retry/serve-cached policy.
 *
 * @returns The raw player achievements payload, or `null` when Steam reports
 *          the game has none (persisted as the known-broken sentinel)
 */
export async function syncGameAchievements(
  steamId: string,
  appId: number,
  options?: { forceRefresh?: boolean },
): Promise<GameAchievements | null> {
  const [playerAchievements, schemaFetched] = await Promise.all([
    getPlayerAchievements(steamId, appId),
    ensureSchema(appId, options),
  ])

  if (playerAchievements && !schemaFetched && isSchemaOutOfSync(appId, playerAchievements.achievements)) {
    await ensureSchema(appId, { forceRefresh: true })
  }

  persistAchievements(steamId, appId, playerAchievements?.achievements ?? [])
  return playerAchievements
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

  let playerAchievements: GameAchievements | null
  try {
    playerAchievements = await syncGameAchievements(steamId, appId, options)
  } catch (error) {
    if (!(error instanceof TransientSteamAPIError)) throw error

    // A rate-limit/network/5xx blip says nothing about whether this game has
    // achievements — don't persist over it (that would cache "broken" for up
    // to ACHIEVEMENTS_STALE_MS). Serve whatever we already have instead, and
    // leave achievements_synced_at untouched so the next request retries.
    const cached = readStoredAchievementsList(steamId, appId)
    if (cached) {
      return {
        steamID: steamId,
        gameName: game.name,
        achievements: cached,
        success: true,
      }
    }
    return null
  }

  // A null payload was already persisted as the 0-achievement sentinel by
  // syncGameAchievements so broken/retired games aren't retried every request.
  if (!playerAchievements) return null

  const achievements = readStoredAchievementsList(steamId, appId)
  return {
    steamID: playerAchievements.steamID,
    gameName: playerAchievements.gameName,
    achievements: achievements ?? [],
    success: playerAchievements.success,
  }
}
