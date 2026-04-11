import "server-only"

import { getPlayerAchievements, type LastPlayedGame } from "@/lib/steam-api"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { isStale, nowIso } from "@/lib/server/steam-store-utils"
import { ensureSchema, ACHIEVEMENTS_STALE_MS } from "@/lib/server/steam-achievements-sync"
import { logger } from "@/lib/server/logger"

export type ExtraGame = {
  appid: number
  name: string | null
  image_landscape_url: string | null
  image_portrait_url: string | null
  image_icon_url: string | null
  playtime_forever: number
  rtime_first_played: number | null
  rtime_last_played: number | null
  unlocked_count: number | null
  total_count: number | null
  perfect_game: number
  achievements_synced_at: string | null
  synced_at: string
}

const EXTRAS_ACHIEVEMENTS_CONCURRENCY = 5

// Delay between sequential store appdetails calls. The endpoint doesn't
// accept batches (any appid count >1 returns "400 null"), so we have to
// fan out single calls. 150ms keeps us well below Steam's rate limiter
// (~200 req/5min community-measured) and lets a 600-game first sync
// complete in ~90s.
const STORE_DELAY_MS = 150

// Sentinel written to games.name when the store appdetails endpoint
// said "no", so the next hydrate pass skips the appid instead of
// hammering it forever.
const NAME_UNRESOLVED_SENTINEL = ""

type StoreAppDetails = {
  success?: boolean
  data?: {
    name?: string
    type?: string
  }
}

/**
 * Fallback name hydrator: for any extras row whose `games.name` is still
 * NULL after the achievement sync, probe the public
 * `store.steampowered.com/api/appdetails` endpoint one appid at a time.
 * Covers live apps that have no Steam achievements (dedicated servers,
 * old demos, …) which GetPlayerAchievements can't name for us.
 *
 * Negative caching: if the store says `success=false` (delisted, no store
 * page) we upsert an empty-string sentinel so the next run skips the
 * appid. The UI falls back to `App #{appid}` for any game whose name is
 * null OR empty via `game.name || fallback`.
 *
 * Swallows per-call errors. On 5 consecutive failures we back off entirely
 * (Akamai/rate-limit guard).
 */
export async function hydrateMissingExtraNames(steamId: string) {
  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
      SELECT e.appid
      FROM extra_games e
      LEFT JOIN games g ON g.appid = e.appid
      WHERE e.steam_id = ? AND g.name IS NULL
      ORDER BY e.playtime_forever DESC
    `,
    )
    .all(steamId) as Array<{ appid: number }>

  if (rows.length === 0) return

  const upsertGame = db.prepare(`
    INSERT INTO games (appid, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      name = excluded.name,
      updated_at = excluded.updated_at
  `)

  let consecutiveFailures = 0

  for (const { appid } of rows) {
    if (consecutiveFailures >= 5) {
      logger.warn(
        { steamId, remaining: rows.length, lastAppid: appid },
        "Store appdetails returned 5 consecutive failures — backing off hydrateMissingExtraNames",
      )
      return
    }

    try {
      const url = new URL("https://store.steampowered.com/api/appdetails")
      url.searchParams.set("appids", String(appid))
      url.searchParams.set("filters", "basic")
      const response = await fetch(url.toString(), { cache: "no-store" })

      if (!response.ok) {
        consecutiveFailures++
        continue
      }
      consecutiveFailures = 0

      const payload = (await response.json()) as Record<string, StoreAppDetails>
      const entry = payload[String(appid)]
      const resolvedName = entry?.success && entry.data?.name ? entry.data.name : null
      const now = nowIso()

      if (resolvedName) {
        upsertGame.run(appid, resolvedName, now, now)
      } else {
        // Negative cache: mark this appid as "we asked, nothing to show"
        upsertGame.run(appid, NAME_UNRESOLVED_SENTINEL, now, now)
      }
    } catch (error) {
      consecutiveFailures++
      logger.warn({ err: error, appid }, "Store appdetails call failed")
    }

    // Rate-limit friendliness: stay well below the ~200 req / 5min ceiling.
    await new Promise((resolve) => setTimeout(resolve, STORE_DELAY_MS))
  }
}

/**
 * Upserts every played-game row that is NOT in the user's owned library and
 * NOT a pinned game. These surface refunded, family-shared, delisted and
 * otherwise-unowned games whose playtime Steam still remembers via
 * ClientGetLastPlayedTimes.
 *
 * Fully isolated from `user_games` so nothing in `extra_games` can leak into
 * library stats / KPIs / insights.
 */
export function persistExtraGames(steamId: string, lastPlayed: LastPlayedGame[]) {
  const db = getSqliteDatabase()

  // Self-healing: drop any extras row whose appid is currently owned (in
  // user_games with owned=1). Protects against the case where a previous
  // sync wrongly added library games to extras because GetOwnedGames
  // returned empty — a subsequent successful sync puts them back in
  // user_games, and this cleanup removes the stale extras rows.
  db.prepare(
    `
    DELETE FROM extra_games
    WHERE steam_id = ?
      AND appid IN (SELECT appid FROM user_games WHERE steam_id = ? AND owned = 1)
  `,
  ).run(steamId, steamId)

  if (lastPlayed.length === 0) return

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
}

/**
 * Persists unlocked achievements + count metadata for a single extras game.
 * Mirrors `persistAchievements` for the library path but writes to the
 * physically separate `extra_game_achievements` table and updates count
 * columns on `extra_games`, never on `user_games`.
 */
export function persistExtraAchievements(
  steamId: string,
  appId: number,
  gameName: string,
  achievements: Array<{ apiname?: string; achieved: number; unlocktime?: number }>,
) {
  const db = getSqliteDatabase()
  const now = nowIso()

  // Dedupe apinames the same way persistAchievements does — Steam occasionally
  // repeats entries in the bulk response.
  const unlockedByApiname = new Map<string, { apiname: string; unlocktime?: number }>()
  for (const achievement of achievements) {
    if (!achievement.apiname || achievement.achieved !== 1) continue
    if (!unlockedByApiname.has(achievement.apiname)) {
      unlockedByApiname.set(achievement.apiname, {
        apiname: achievement.apiname,
        unlocktime: achievement.unlocktime,
      })
    }
  }
  const unlockedCount = unlockedByApiname.size
  const totalCount = achievements.length
  const perfectGame = totalCount > 0 && unlockedCount === totalCount ? 1 : 0

  db.exec("BEGIN")
  try {
    // Cache the game name on the shared games table so the UI can show it.
    // This is the authoritative name source for delisted games — far more
    // reliable than the public store appdetails API.
    if (gameName) {
      db.prepare(
        `
        INSERT INTO games (appid, name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(appid) DO UPDATE SET
          name = excluded.name,
          updated_at = excluded.updated_at
      `,
      ).run(appId, gameName, now, now)
    }

    db.prepare(
      `
      UPDATE extra_games
      SET
        achievements_synced_at = ?,
        unlocked_count = ?,
        total_count = ?,
        perfect_game = ?,
        updated_at = ?
      WHERE steam_id = ? AND appid = ?
    `,
    ).run(now, unlockedCount, totalCount, perfectGame, now, steamId, appId)

    db.prepare(`DELETE FROM extra_game_achievements WHERE steam_id = ? AND appid = ?`).run(steamId, appId)

    const insert = db.prepare(`
      INSERT INTO extra_game_achievements (
        steam_id, appid, apiname, achieved, unlock_time, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?, ?)
    `)
    for (const entry of unlockedByApiname.values()) {
      insert.run(steamId, appId, entry.apiname, entry.unlocktime ?? null, now, now)
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

/**
 * Syncs achievements for every extras row that needs refreshing. Uses the
 * same incremental filter as the library path: skip if the stored data is
 * fresh and rtime_last_played hasn't advanced. 7-day staleness floor for
 * rare edge cases where achievements unlock without moving rtime.
 *
 * Runs per-game GetPlayerAchievements + ensureSchema with concurrency=5.
 * Swallows per-game failures so a single broken entry can't abort the whole
 * extras sync.
 */
export async function syncExtraAchievements(steamId: string) {
  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
      SELECT appid, rtime_last_played, achievements_synced_at, total_count
      FROM extra_games
      WHERE steam_id = ?
    `,
    )
    .all(steamId) as Array<{
    appid: number
    rtime_last_played: number | null
    achievements_synced_at: string | null
    total_count: number | null
  }>

  const stale = rows.filter((row) => {
    // Known-broken: synced once, reported 0 achievements (stats-only games,
    // games without any Steam achievements, etc). Don't retry.
    if (row.achievements_synced_at && (row.total_count ?? 0) === 0) return false
    // Never synced → include.
    if (!row.achievements_synced_at) return true
    // Weekly staleness floor catches edge cases where rtime didn't move.
    if (isStale(row.achievements_synced_at, ACHIEVEMENTS_STALE_MS)) return true
    // Incremental: only re-sync if the game was played after our last sync.
    const syncedAtMs = Date.parse(row.achievements_synced_at)
    const playedAtMs = (row.rtime_last_played ?? 0) * 1000
    return playedAtMs > syncedAtMs
  })

  if (stale.length === 0) return

  let cursor = 0
  async function worker() {
    while (cursor < stale.length) {
      const index = cursor++
      if (index >= stale.length) return
      const row = stale[index]
      try {
        const [playerAchievements] = await Promise.all([
          getPlayerAchievements(steamId, row.appid),
          ensureSchema(row.appid),
        ])
        if (!playerAchievements) {
          // Mark as known-broken so we don't retry every sync.
          persistExtraAchievements(steamId, row.appid, "", [])
          continue
        }
        persistExtraAchievements(steamId, row.appid, playerAchievements.gameName, playerAchievements.achievements ?? [])
      } catch (error) {
        logger.warn({ err: error, appId: row.appid }, "Per-extras achievements sync failed — will retry on next sync")
      }
    }
  }
  await Promise.all(Array.from({ length: EXTRAS_ACHIEVEMENTS_CONCURRENCY }, worker))
}

/**
 * Returns every extra-games row for a user, joined with the shared games
 * name + image cache. Ordered by playtime desc then last_played desc.
 */
export function getExtraGamesForUser(steamId: string): ExtraGame[] {
  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
      SELECT
        e.appid,
        g.name,
        g.image_landscape_url,
        g.image_portrait_url,
        g.image_icon_url,
        e.playtime_forever,
        e.rtime_first_played,
        e.rtime_last_played,
        e.unlocked_count,
        e.total_count,
        e.perfect_game,
        e.achievements_synced_at,
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

/** Returns the list of appids currently tracked as extras for a user. */
export function getExtraAppIds(steamId: string): number[] {
  const db = getSqliteDatabase()
  const rows = db.prepare(`SELECT appid FROM extra_games WHERE steam_id = ?`).all(steamId) as Array<{ appid: number }>
  return rows.map((r) => r.appid)
}
