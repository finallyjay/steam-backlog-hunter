import "server-only"

import { getGameSchema, getPlayerAchievements, type LastPlayedGame } from "@/lib/steam-api"
import { ensureSchema } from "@/lib/server/steam-achievements-sync"
import type { SteamAchievementView } from "@/lib/types/steam"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { isStale, nowIso } from "@/lib/server/steam-store-utils"
import { ACHIEVEMENTS_STALE_MS } from "@/lib/server/steam-achievements-sync"
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

type StoreAppDetails = {
  success?: boolean
  data?: {
    name?: string
    type?: string
  }
}

/**
 * Last-resort name resolver: scrape the HTML title of the Steam community
 * page for the given appid. Used for delisted achievement-less apps that
 * neither store appdetails nor GetSchemaForGame can name (server builds,
 * soundtracks, demos, experimental indie titles, …). Returns null on any
 * failure or sentinel response.
 *
 * Example: app 502090 ("Invisible Mind") is delisted with no schema, so the
 * structured endpoints return nothing. The community page still serves a
 * `<title>Steam Community :: Invisible Mind</title>` for it.
 */
async function fetchCommunityGameName(appId: number): Promise<string | null> {
  try {
    const response = await fetch(`https://steamcommunity.com/app/${appId}`, {
      cache: "no-store",
      redirect: "follow",
    })
    if (!response.ok) return null
    const html = await response.text()
    const match = html.match(/<title>Steam Community :: ([^<]+)<\/title>/)
    if (!match) return null
    const name = decodeBasicHtmlEntities(match[1].trim())
    // Sentinel values Steam returns for unknown/invalid appids on this URL.
    if (name === "Error") return null
    return name
  } catch {
    return null
  }
}

function decodeBasicHtmlEntities(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
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
 * Swallows per-call errors. On 10 consecutive store failures we back off
 * (Akamai/rate-limit guard). When the store API returns success=false
 * (delisted/removed apps), falls back to GetSchemaForGame which returns
 * gameName even for delisted titles.
 *
 * Does NOT write a sentinel for unresolvable apps: leaving the games row
 * absent keeps the LEFT JOIN NULL so the next sync can retry. This avoids
 * the old permanent-stick problem where a single transient store failure
 * would brand an app as "App #12345" forever.
 */
export async function hydrateMissingExtraNames(steamId: string) {
  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
      SELECT e.appid
      FROM extra_games e
      LEFT JOIN games g ON g.appid = e.appid
      WHERE e.steam_id = ? AND (g.appid IS NULL OR g.name IS NULL OR g.name = '')
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

  let consecutiveStoreFailures = 0

  for (const { appid } of rows) {
    if (consecutiveStoreFailures >= 10) {
      logger.warn(
        { steamId, remaining: rows.length, lastAppid: appid },
        "Store appdetails returned 10 consecutive failures — backing off hydrateMissingExtraNames",
      )
      return
    }

    let resolvedName: string | null = null

    // Source 1: store appdetails (works for most active apps)
    try {
      const url = new URL("https://store.steampowered.com/api/appdetails")
      url.searchParams.set("appids", String(appid))
      url.searchParams.set("filters", "basic")
      const response = await fetch(url.toString(), { cache: "no-store" })

      if (!response.ok) {
        consecutiveStoreFailures++
      } else {
        consecutiveStoreFailures = 0
        const payload = (await response.json()) as Record<string, StoreAppDetails>
        const entry = payload[String(appid)]
        resolvedName = entry?.success && entry.data?.name ? entry.data.name : null
      }
    } catch (error) {
      consecutiveStoreFailures++
      logger.warn({ err: error, appid }, "Store appdetails call failed")
    }

    // Source 2: GetSchemaForGame (works for delisted apps the store rejects)
    if (!resolvedName) {
      try {
        const schema = (await getGameSchema(appid)) as { gameName?: string } | null
        if (schema?.gameName) {
          resolvedName = schema.gameName
        }
      } catch {
        // non-critical
      }
    }

    // Source 3: community page HTML (covers delisted achievement-less apps
    // that neither store nor schema can name — e.g. dedicated servers,
    // soundtracks, demos, one-off experimental indies). Different host so
    // failures don't count toward the store back-off counter.
    if (!resolvedName) {
      const communityName = await fetchCommunityGameName(appid)
      if (communityName) {
        resolvedName = communityName
      }
    }

    if (resolvedName) {
      const now = nowIso()
      upsertGame.run(appid, resolvedName, now, now)
    }

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
 * Runs per-game GetPlayerAchievements with concurrency=5.
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
        // No ensureSchema() here on purpose: the extras UI only shows
        // aggregate unlock counts (serverTotal / serverUnlocked), never
        // per-achievement metadata. Skipping the schema sync avoids a
        // FOREIGN KEY failure on game_achievements(appid)→games(appid) for
        // extras whose appid isn't in `games` yet, which on a fresh database
        // was preventing every extras sync from persisting anything.
        const playerAchievements = await getPlayerAchievements(steamId, row.appid)
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
        AND NOT EXISTS (SELECT 1 FROM hidden_games hg WHERE hg.steam_id = e.steam_id AND hg.appid = e.appid)
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

export type HiddenGame = {
  appid: number
  name: string | null
  image_landscape_url: string | null
  image_portrait_url: string | null
  image_icon_url: string | null
  playtime_forever: number | null
  hidden_at: string
  source: "library" | "extras"
}

/** Returns all hidden games for a user, from both library and extras. */
export function getHiddenGamesForUser(steamId: string): HiddenGame[] {
  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
      SELECT
        hg.appid,
        g.name,
        g.image_landscape_url,
        g.image_portrait_url,
        g.image_icon_url,
        COALESCE(ug.playtime_forever, eg.playtime_forever) AS playtime_forever,
        hg.hidden_at,
        CASE
          WHEN ug.steam_id IS NOT NULL THEN 'library'
          ELSE 'extras'
        END AS source
      FROM hidden_games hg
      LEFT JOIN games g ON g.appid = hg.appid
      LEFT JOIN user_games ug ON ug.steam_id = hg.steam_id AND ug.appid = hg.appid AND ug.owned = 1
      LEFT JOIN extra_games eg ON eg.steam_id = hg.steam_id AND eg.appid = hg.appid
      WHERE hg.steam_id = ?
      ORDER BY hg.hidden_at DESC
    `,
    )
    .all(steamId) as HiddenGame[]
  return rows
}

/** Returns a single extra game for a user, or null if not found. */
export function getStoredExtraGame(steamId: string, appId: number): ExtraGame | null {
  const db = getSqliteDatabase()
  const row = db
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
      WHERE e.steam_id = ? AND e.appid = ?
    `,
    )
    .get(steamId, appId) as ExtraGame | undefined
  return row ?? null
}

/**
 * Reads enriched achievements for an extra game. Calls ensureSchema
 * on-demand to populate game_achievements (names, icons) if missing,
 * then joins with extra_game_achievements for unlock status.
 */
export async function getExtraAchievementsList(steamId: string, appId: number): Promise<SteamAchievementView[] | null> {
  const db = getSqliteDatabase()

  const meta = db
    .prepare(`SELECT achievements_synced_at FROM extra_games WHERE steam_id = ? AND appid = ?`)
    .get(steamId, appId) as { achievements_synced_at: string | null } | undefined
  if (!meta?.achievements_synced_at) return null

  // Ensure games row exists so ensureSchema's FK on game_achievements won't fail
  const gamesRow = db.prepare(`SELECT 1 FROM games WHERE appid = ?`).get(appId)
  if (!gamesRow) {
    const now = nowIso()
    db.prepare(`INSERT OR IGNORE INTO games (appid, name, created_at, updated_at) VALUES (?, '', ?, ?)`).run(
      appId,
      now,
      now,
    )
  }

  await ensureSchema(appId)

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
        COALESCE(ea.achieved, 0) AS achieved,
        COALESCE(ea.unlock_time, 0) AS unlock_time
      FROM game_achievements ga
      LEFT JOIN extra_game_achievements ea
        ON ea.appid = ga.appid
        AND ea.apiname = ga.apiname
        AND ea.steam_id = ?
      WHERE ga.appid = ?
      ORDER BY ga.apiname
    `,
    )
    .all(steamId, appId) as Array<{
    appid: number
    apiname: string
    display_name: string | null
    description: string | null
    icon: string | null
    icon_gray: string | null
    achieved: number
    unlock_time: number | null
  }>

  if (rows.length === 0) return null

  return rows.map((row) => ({
    apiname: row.apiname,
    achieved: row.achieved,
    unlocktime: row.unlock_time ?? 0,
    name: row.display_name ?? row.apiname,
    description: row.description ?? "",
    displayName: row.display_name ?? row.apiname,
    icon: row.icon ?? "",
    icongray: row.icon_gray ?? "",
  }))
}
