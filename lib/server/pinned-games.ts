import "server-only"

import { getPlayerAchievements } from "@/lib/steam-api"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { nowIso } from "@/lib/server/steam-store-utils"
import { logger } from "@/lib/server/logger"

export type PinnedGame = {
  appid: number
  reason: string | null
  added_at: string
}

/** Returns every globally pinned appid. */
export function listPinnedGames(): PinnedGame[] {
  const db = getSqliteDatabase()
  return db.prepare("SELECT appid, reason, added_at FROM pinned_games ORDER BY appid").all() as PinnedGame[]
}

/** Adds an appid to the global pinned list. Idempotent. */
export function addPinnedGame(appid: number, reason: string | null) {
  const db = getSqliteDatabase()
  db.prepare("INSERT OR IGNORE INTO pinned_games (appid, reason, added_at) VALUES (?, ?, ?)").run(
    appid,
    reason,
    nowIso(),
  )
}

/** Removes an appid from the global pinned list. */
export function removePinnedGame(appid: number) {
  const db = getSqliteDatabase()
  db.prepare("DELETE FROM pinned_games WHERE appid = ?").run(appid)
}

/**
 * For every globally pinned appid that is NOT in the set of app ids Steam
 * just returned from GetOwnedGames, attempt to resolve it via
 * GetPlayerAchievements. If Steam responds with achievements, upsert a
 * games + user_games row so the rest of the app treats it as owned. If
 * Steam responds with 400/403 / success=false, leave it alone — the user
 * doesn't own that pinned appid.
 *
 * Intentionally swallows per-appid errors so one bad entry can't abort the
 * whole sync.
 */
export async function ensurePinnedGamesSynced(steamId: string, existingOwnedAppIds: Set<number>) {
  const pinned = listPinnedGames()
  if (pinned.length === 0) return

  const db = getSqliteDatabase()
  const upsertGame = db.prepare(`
    INSERT INTO games (appid, name, has_community_visible_stats, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      name = excluded.name,
      has_community_visible_stats = 1,
      updated_at = excluded.updated_at
  `)
  const upsertUserGame = db.prepare(`
    INSERT INTO user_games (
      steam_id, appid, playtime_forever, owned, last_seen_in_owned_games_at, created_at, updated_at
    ) VALUES (?, ?, 0, 1, ?, ?, ?)
    ON CONFLICT(steam_id, appid) DO UPDATE SET
      owned = 1,
      last_seen_in_owned_games_at = excluded.last_seen_in_owned_games_at,
      updated_at = excluded.updated_at
  `)

  for (const { appid } of pinned) {
    if (existingOwnedAppIds.has(appid)) continue

    try {
      const result = await getPlayerAchievements(steamId, appid)
      if (!result || !result.success) continue

      const now = nowIso()
      upsertGame.run(appid, result.gameName || `App ${appid}`, now, now)
      upsertUserGame.run(steamId, appid, now, now, now)
    } catch (error) {
      logger.warn({ err: error, appId: appid }, "Pinned game resolution failed — will retry on next sync")
    }
  }
}
