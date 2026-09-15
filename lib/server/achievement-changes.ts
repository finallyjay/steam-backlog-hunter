import "server-only"

import type { AchievementChangeView } from "@/lib/types/steam"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { nowIso, parseJson } from "@/lib/server/steam-store-utils"
import { logger } from "@/lib/server/logger"

type AchievementChangeRow = {
  id: number
  appid: number
  game_name: string
  added: string
  removed: string
  total_before: number | null
  total_after: number
  was_perfect: number
  detected_at: string
  seen_at: string | null
}

type OwnerRow = {
  steam_id: string
  total_count: number | null
  perfect_game: number
}

function mapRowToView(row: AchievementChangeRow): AchievementChangeView {
  return {
    id: row.id,
    appId: row.appid,
    gameName: row.game_name,
    added: parseJson<string[]>(row.added) ?? [],
    removed: parseJson<string[]>(row.removed) ?? [],
    totalBefore: row.total_before,
    totalAfter: row.total_after,
    wasPerfect: row.was_perfect === 1,
    detectedAt: row.detected_at,
    seenAt: row.seen_at,
  }
}

/**
 * Computes the symmetric difference between the apinames we had stored for
 * a game and the apinames Steam now returns.
 *
 * Pure helper, exported for tests. Order of the returned arrays follows the
 * insertion order of the input sets so output is deterministic.
 */
export function diffApinames(stored: Iterable<string>, incoming: Iterable<string>) {
  const storedSet = new Set(stored)
  const incomingSet = new Set(incoming)
  const added: string[] = []
  const removed: string[] = []
  for (const name of incomingSet) if (!storedSet.has(name)) added.push(name)
  for (const name of storedSet) if (!incomingSet.has(name)) removed.push(name)
  return { added, removed }
}

/**
 * Records one `achievement_changes` row per user who owns `appId` and has
 * already synced its achievements.
 *
 * `totalBefore`/`wasPerfect` are read from each owner's `user_games` row
 * *at call time*, so this must run before `persistAchievements` overwrites
 * the counts for the current sync. Users who never synced the game (or whose
 * last sync recorded 0 achievements, the known-broken sentinel) get no row:
 * there is no meaningful "before" for them and a transient-failure recovery
 * would otherwise look like "+N new achievements".
 *
 * Must be called inside an open transaction by the caller; this function
 * issues no BEGIN/COMMIT of its own.
 *
 * @returns Number of rows written
 */
export function recordAchievementChanges(
  appId: number,
  change: { added: string[]; removed: string[]; totalAfter: number },
): number {
  if (change.added.length === 0 && change.removed.length === 0) return 0

  const db = getSqliteDatabase()
  const now = nowIso()
  const owners = db
    .prepare(
      `
      SELECT steam_id, total_count, perfect_game
      FROM user_games
      WHERE appid = ?
        AND owned = 1
        AND achievements_synced_at IS NOT NULL
        AND total_count > 0
    `,
    )
    .all(appId) as OwnerRow[]

  if (owners.length === 0) return 0

  const insert = db.prepare(`
    INSERT INTO achievement_changes (
      steam_id, appid, added, removed, total_before, total_after, was_perfect, detected_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const added = JSON.stringify(change.added)
  const removed = JSON.stringify(change.removed)
  for (const owner of owners) {
    insert.run(owner.steam_id, appId, added, removed, owner.total_count, change.totalAfter, owner.perfect_game, now)
  }

  logger.info(
    { appId, added: change.added.length, removed: change.removed.length, owners: owners.length },
    "Achievement schema change detected",
  )
  return owners.length
}

/**
 * Lists detected achievement changes for a user, newest first.
 *
 * @param options.unseenOnly - When true, only rows without `seen_at` are returned
 * @param options.limit - Maximum rows to return (default 100)
 */
export function listAchievementChanges(
  steamId: string,
  options?: { unseenOnly?: boolean; limit?: number },
): AchievementChangeView[] {
  const db = getSqliteDatabase()
  const unseenOnly = options?.unseenOnly ?? false
  const limit = Math.max(1, Math.min(options?.limit ?? 100, 500))

  const rows = db
    .prepare(
      `
      SELECT
        ac.id,
        ac.appid,
        g.name AS game_name,
        ac.added,
        ac.removed,
        ac.total_before,
        ac.total_after,
        ac.was_perfect,
        ac.detected_at,
        ac.seen_at
      FROM achievement_changes ac
      JOIN games g ON g.appid = ac.appid
      WHERE ac.steam_id = ?
        ${unseenOnly ? "AND ac.seen_at IS NULL" : ""}
      ORDER BY ac.detected_at DESC, ac.id DESC
      LIMIT ?
    `,
    )
    .all(steamId, limit) as AchievementChangeRow[]

  return rows.map(mapRowToView)
}

/**
 * Marks achievement changes as seen for a user.
 *
 * Only rows belonging to `steamId` are touched, so a caller cannot acknowledge
 * another user's changes by guessing ids. Already-seen rows keep their
 * original `seen_at`.
 *
 * @param ids - Specific change ids to mark; when omitted, every unseen row for the user is marked
 * @returns Number of rows updated
 */
export function markAchievementChangesSeen(steamId: string, ids?: number[]): number {
  const db = getSqliteDatabase()
  const now = nowIso()

  if (ids === undefined) {
    const result = db
      .prepare(`UPDATE achievement_changes SET seen_at = ? WHERE steam_id = ? AND seen_at IS NULL`)
      .run(now, steamId)
    return Number(result.changes)
  }

  const validIds = ids.filter((id) => Number.isInteger(id) && id > 0)
  if (validIds.length === 0) return 0

  const placeholders = validIds.map(() => "?").join(",")
  const result = db
    .prepare(
      `UPDATE achievement_changes SET seen_at = ?
       WHERE steam_id = ? AND seen_at IS NULL AND id IN (${placeholders})`,
    )
    .run(now, steamId, ...validIds)
  return Number(result.changes)
}
