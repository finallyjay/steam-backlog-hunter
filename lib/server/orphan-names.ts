import "server-only"

import { PLACEHOLDER_NAME_SQL_MATCH } from "@/lib/server/placeholder-names"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { nowIso } from "@/lib/server/steam-store-utils"

/**
 * A game whose `games.name` is missing or empty and that at least one user
 * has either in their library (owned or pinned) or in their extras list.
 * Surfaced through the admin UI so the operator can fill in a name Valve
 * no longer publishes anywhere (truly dead apps that even the Support
 * wizard can't resolve).
 */
export type OrphanName = {
  appid: number
  /** Raw name currently stored (may be empty string or null). */
  current_name: string | null
  /** Whether this orphan came from the user's library, extras, or both. */
  sources: Array<"library" | "extras">
  /** Highest playtime minutes across any user that has it (library ∪ extras). */
  playtime_forever: number
  rtime_first_played: number | null
  rtime_last_played: number | null
}

/**
 * Lists every game row whose name is NULL/empty AND is referenced by at
 * least one `user_games` (owned=1) or `extra_games` row. Scans across
 * every user in the DB so a single admin can resolve orphan names for
 * the whole instance, not just their own account.
 *
 * Ordered by playtime descending so the operator sees the most-played
 * unnamed games first.
 */
export function listOrphanNames(): OrphanName[] {
  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
      WITH referenced AS (
        SELECT
          ug.appid AS appid,
          'library' AS source,
          ug.playtime_forever AS playtime_forever,
          ug.rtime_first_played AS rtime_first_played,
          ug.rtime_last_played AS rtime_last_played
        FROM user_games ug
        WHERE ug.owned = 1
        UNION ALL
        SELECT
          e.appid AS appid,
          'extras' AS source,
          e.playtime_forever AS playtime_forever,
          e.rtime_first_played AS rtime_first_played,
          e.rtime_last_played AS rtime_last_played
        FROM extra_games e
      )
      SELECT
        r.appid AS appid,
        g.name AS current_name,
        GROUP_CONCAT(DISTINCT r.source) AS sources_csv,
        MAX(r.playtime_forever) AS playtime_forever,
        MIN(r.rtime_first_played) AS rtime_first_played,
        MAX(r.rtime_last_played) AS rtime_last_played
      FROM referenced r
      LEFT JOIN games g ON g.appid = r.appid
      WHERE (
        g.appid IS NULL
        OR g.name IS NULL
        OR g.name = ''
        OR ${PLACEHOLDER_NAME_SQL_MATCH}
      )
      GROUP BY r.appid
      ORDER BY playtime_forever DESC
      `,
    )
    .all() as Array<{
    appid: number
    current_name: string | null
    sources_csv: string
    playtime_forever: number
    rtime_first_played: number | null
    rtime_last_played: number | null
  }>

  return rows.map((row) => ({
    appid: row.appid,
    current_name: row.current_name,
    sources: row.sources_csv.split(",").filter((s): s is "library" | "extras" => s === "library" || s === "extras"),
    playtime_forever: row.playtime_forever,
    rtime_first_played: row.rtime_first_played,
    rtime_last_played: row.rtime_last_played,
  }))
}

/**
 * Upserts a manual name into the games table and freezes it by setting
 * `name_source = 'manual'`. Every auto-sync path respects this flag and
 * leaves the name untouched on subsequent upserts.
 *
 * @throws RangeError when `name` is outside [1, 200] characters after trimming.
 */
export function setManualName(appid: number, name: string): void {
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 200) {
    throw new RangeError("Name must be between 1 and 200 characters")
  }

  const db = getSqliteDatabase()
  const now = nowIso()
  db.prepare(
    `
    INSERT INTO games (appid, name, name_source, created_at, updated_at)
    VALUES (?, ?, 'manual', ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      name = excluded.name,
      name_source = 'manual',
      updated_at = excluded.updated_at
    `,
  ).run(appid, trimmed, now, now)
}

/**
 * Reverts a previously-manual name back to the auto resolution chain:
 * clears the name to an empty string and flips `name_source = 'auto'`
 * so the next `hydrateMissingExtraNames` pass will try to resolve it
 * again via catalog/store/schema/support/community. Useful when Valve
 * restores an endpoint we can scrape, or when the admin changes their
 * mind about a name.
 *
 * No-op for rows that do not exist.
 */
export function clearManualName(appid: number): void {
  const db = getSqliteDatabase()
  const now = nowIso()
  db.prepare(
    `UPDATE games SET name = '', name_source = 'auto', updated_at = ? WHERE appid = ? AND name_source = 'manual'`,
  ).run(now, appid)
}
