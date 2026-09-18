import "server-only"

import { getSqliteDatabase } from "@/lib/server/sqlite"
import { getStoredExtraGame } from "@/lib/server/extra-games"
import { getStoredGame } from "@/lib/server/steam-games-sync"
import { syncGameAchievements } from "@/lib/server/steam-achievements-sync"
import { invalidateStatsCache } from "@/lib/steam-stats"
import { nowIso } from "@/lib/server/steam-store-utils"
import { logger } from "@/lib/server/logger"
import type { SteamGame } from "@/lib/steam-api"

/**
 * Promotes one of the user's extras into their library: the game counts
 * for stats, insights and the achievement scan from now on, and the
 * library sync leaves it alone (`user_games.owned_source = 'manual'`).
 *
 * Steps, in one transaction: make sure a `games` row exists, upsert the
 * `user_games` row with owned = 1 / manual and the playtime and play
 * timestamps recorded on the extra, then drop the extra and its
 * achievement rows. After committing, the game's achievements are synced
 * into the library tables (best effort: a Steam hiccup here leaves a row
 * the next per-game or scheduled sync will fill).
 *
 * @returns The promoted game as the library sees it, or null when the app
 *   is not one of the user's extras.
 */
export async function promoteExtraToLibrary(steamId: string, appId: number): Promise<SteamGame | null> {
  const extra = getStoredExtraGame(steamId, appId)
  if (!extra) return null

  const db = getSqliteDatabase()
  const now = nowIso()
  db.exec("BEGIN")
  try {
    db.prepare(`INSERT OR IGNORE INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
      appId,
      extra.name ?? "",
      now,
      now,
    )
    db.prepare(
      `
      INSERT INTO user_games (
        steam_id, appid, playtime_forever, rtime_last_played, rtime_first_played,
        owned, owned_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 'manual', ?, ?)
      ON CONFLICT(steam_id, appid) DO UPDATE SET
        playtime_forever = excluded.playtime_forever,
        rtime_last_played = COALESCE(excluded.rtime_last_played, user_games.rtime_last_played),
        rtime_first_played = COALESCE(excluded.rtime_first_played, user_games.rtime_first_played),
        owned = 1,
        owned_source = 'manual',
        updated_at = excluded.updated_at
    `,
    ).run(steamId, appId, extra.playtime_forever, extra.rtime_last_played, extra.rtime_first_played, now, now)
    db.prepare(`DELETE FROM extra_game_achievements WHERE steam_id = ? AND appid = ?`).run(steamId, appId)
    db.prepare(`DELETE FROM extra_games WHERE steam_id = ? AND appid = ?`).run(steamId, appId)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }

  try {
    await syncGameAchievements(steamId, appId)
  } catch (error) {
    logger.warn({ err: error, steamId, appId }, "Achievements sync after promotion failed — will retry on next sync")
  }
  invalidateStatsCache(steamId)
  logger.info({ steamId, appId }, "Extra promoted to library")
  return getStoredGame(steamId, appId)
}

/**
 * Reverses {@link promoteExtraToLibrary}: the row goes back to
 * owned = 0 / auto and the game reappears in extras right away (with the
 * playtime and timestamps the library row had), instead of waiting for
 * the next discovery to pick it up.
 *
 * Only rows with `owned_source = 'manual'` can be demoted; games Steam
 * reports as owned are Steam's call.
 *
 * @returns true when a row was demoted, false when the app is not a
 *   manually owned game of the user.
 */
export function demoteManualGame(steamId: string, appId: number): boolean {
  const db = getSqliteDatabase()
  const row = db
    .prepare(
      `SELECT playtime_forever, rtime_last_played, rtime_first_played
       FROM user_games WHERE steam_id = ? AND appid = ? AND owned = 1 AND owned_source = 'manual'`,
    )
    .get(steamId, appId) as
    | { playtime_forever: number; rtime_last_played: number | null; rtime_first_played: number | null }
    | undefined
  if (!row) return false

  const now = nowIso()
  db.exec("BEGIN")
  try {
    db.prepare(
      `UPDATE user_games SET owned = 0, owned_source = 'auto', updated_at = ? WHERE steam_id = ? AND appid = ?`,
    ).run(now, steamId, appId)
    db.prepare(
      `
      INSERT INTO extra_games (
        steam_id, appid, playtime_forever, rtime_first_played, rtime_last_played, synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(steam_id, appid) DO UPDATE SET
        playtime_forever = excluded.playtime_forever,
        rtime_first_played = COALESCE(excluded.rtime_first_played, extra_games.rtime_first_played),
        rtime_last_played = COALESCE(excluded.rtime_last_played, extra_games.rtime_last_played),
        synced_at = excluded.synced_at,
        updated_at = excluded.updated_at
    `,
    ).run(steamId, appId, row.playtime_forever, row.rtime_first_played, row.rtime_last_played, now, now, now)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  invalidateStatsCache(steamId)
  logger.info({ steamId, appId }, "Manual game returned to extras")
  return true
}
