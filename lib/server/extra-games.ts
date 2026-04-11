import "server-only"

import type { LastPlayedGame } from "@/lib/steam-api"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { nowIso } from "@/lib/server/steam-store-utils"
import { logger } from "@/lib/server/logger"

export type ExtraGame = {
  appid: number
  name: string | null
  playtime_forever: number
  rtime_first_played: number | null
  rtime_last_played: number | null
  synced_at: string
}

// Store API: max 200 appids per request, rate-limited ~200 req / 5min per IP.
// We only batch during the owned-games refresh (~every 24h per user), so one
// fan-out of 3 calls on first sync is fine.
const STORE_BATCH_SIZE = 200

type StoreAppDetails = {
  success?: boolean
  data?: {
    name?: string
    type?: string
  }
}

/**
 * Fetches `name` from the public store `appdetails` API for the given ids and
 * upserts them into the shared `games` name cache. Subsequent queries that
 * join against `games` will surface the names without re-fetching.
 *
 * Swallows per-batch errors so a transient store outage doesn't break the
 * whole sync. Appids whose store entry 404s or returns `success=false`
 * (delisted with no remaining metadata) are simply left nameless.
 */
async function hydrateMissingGameNames(appIds: number[]) {
  if (appIds.length === 0) return

  const db = getSqliteDatabase()
  const now = nowIso()
  const upsertGame = db.prepare(`
    INSERT INTO games (appid, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      name = COALESCE(excluded.name, games.name),
      updated_at = excluded.updated_at
  `)

  for (let i = 0; i < appIds.length; i += STORE_BATCH_SIZE) {
    const batch = appIds.slice(i, i + STORE_BATCH_SIZE)
    try {
      const url = new URL("https://store.steampowered.com/api/appdetails")
      url.searchParams.set("appids", batch.join(","))
      url.searchParams.set("filters", "basic")
      const response = await fetch(url.toString(), { cache: "no-store" })
      if (!response.ok) continue

      const payload = (await response.json()) as Record<string, StoreAppDetails>
      for (const appid of batch) {
        const entry = payload[String(appid)]
        const name = entry?.success && entry.data?.name ? entry.data.name : null
        upsertGame.run(appid, name, now, now)
      }
    } catch (error) {
      logger.warn({ err: error, batchSize: batch.length }, "Store appdetails batch failed")
    }
  }
}

/**
 * Upserts every played-game row that is NOT in the user's owned library and
 * NOT a pinned game. These surfaces refunded, family-shared, delisted and
 * otherwise-unowned games whose playtime Steam still remembers via
 * ClientGetLastPlayedTimes.
 *
 * Fully isolated from `user_games` so nothing in `extra_games` can leak into
 * library stats / KPIs / insights.
 */
export async function persistExtraGames(steamId: string, lastPlayed: LastPlayedGame[]) {
  if (lastPlayed.length === 0) return

  const db = getSqliteDatabase()

  // Build the skip set: owned library entries + pinned appids. Both sources
  // already live in user_games (pinned games get upserted there during
  // ensurePinnedGamesSynced), so a single query covers both.
  const ownedRows = db.prepare(`SELECT appid FROM user_games WHERE steam_id = ? AND owned = 1`).all(steamId) as Array<{
    appid: number
  }>
  const skip = new Set(ownedRows.map((row) => row.appid))

  const candidates = lastPlayed.filter((game) => {
    if (skip.has(game.appid)) return false
    // Skip entries that never actually accumulated playtime. Steam seems to
    // emit some zero-playtime rows for games the user touched only in a
    // launcher sense (hover / preload); they'd pollute the list.
    if (!game.playtime_forever || game.playtime_forever <= 0) return false
    return true
  })

  if (candidates.length === 0) return

  const now = nowIso()
  const upsert = db.prepare(`
    INSERT INTO extra_games (
      steam_id, appid, playtime_forever, rtime_first_played, rtime_last_played,
      synced_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(steam_id, appid) DO UPDATE SET
      playtime_forever = excluded.playtime_forever,
      rtime_first_played = COALESCE(excluded.rtime_first_played, extra_games.rtime_first_played),
      rtime_last_played = COALESCE(excluded.rtime_last_played, extra_games.rtime_last_played),
      synced_at = excluded.synced_at,
      updated_at = excluded.updated_at
  `)

  db.exec("BEGIN")
  try {
    for (const game of candidates) {
      upsert.run(
        steamId,
        game.appid,
        game.playtime_forever ?? 0,
        game.first_playtime ?? null,
        game.last_playtime ?? null,
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

  // Hydrate names for any candidate appids that don't already have a name
  // cached in the shared `games` table. Fires one extra fan-out of store API
  // calls on first sync (cheap, batches of 200), then becomes a no-op once
  // the cache is warm.
  const nameless = db
    .prepare(
      `
      SELECT e.appid
      FROM extra_games e
      LEFT JOIN games g ON g.appid = e.appid
      WHERE e.steam_id = ? AND (g.name IS NULL OR g.name = '')
    `,
    )
    .all(steamId) as Array<{ appid: number }>

  if (nameless.length > 0) {
    await hydrateMissingGameNames(nameless.map((r) => r.appid))
  }
}

/** Returns every extra-games row for a user, joined with the shared games name cache. */
export function getExtraGamesForUser(steamId: string): ExtraGame[] {
  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
      SELECT
        e.appid,
        g.name,
        e.playtime_forever,
        e.rtime_first_played,
        e.rtime_last_played,
        e.synced_at
      FROM extra_games e
      LEFT JOIN games g ON g.appid = e.appid
      WHERE e.steam_id = ?
      ORDER BY e.playtime_forever DESC, e.rtime_last_played DESC
    `,
    )
    .all(steamId) as ExtraGame[]
  return rows
}
