import "server-only"

import { getGameSchema, getLastPlayedTimes, getPlayerAchievements, type LastPlayedGame } from "@/lib/steam-api"
import { ensureSchema } from "@/lib/server/steam-achievements-sync"
import type { SteamAchievementView } from "@/lib/types/steam"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { ensureGameImages } from "@/lib/server/steam-images"
import { getProfileSync, isStale, markProfileSync, nowIso, upsertProfile } from "@/lib/server/steam-store-utils"
import { ACHIEVEMENTS_STALE_MS } from "@/lib/server/steam-achievements-sync"
import { populateGamesFromSteamCatalog } from "@/lib/server/steam-app-catalog"
import { isPlaceholderName, PLACEHOLDER_NAME_SQL_MATCH } from "@/lib/server/placeholder-names"
import { kindFromName, kindFromStoreType, type AppKind } from "@/lib/server/app-kind"
import { logger } from "@/lib/server/logger"

export type ExtraGame = {
  appid: number
  name: string | null
  /** Coarse app classification, see lib/server/app-kind.ts. */
  kind: AppKind
  /** Provenance of `kind`: 'store' | 'name' | 'manual' | null. */
  kind_source: string | null
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

type NameFetchResult =
  | { kind: "ok"; name: string }
  | { kind: "empty" } // endpoint responded cleanly but had no name for this appid
  | { kind: "rate_limited" } // 429 — caller should back off
  | { kind: "error" } // network / 5xx / malformed — caller decides

/**
 * Name resolver: scrape the <title> of the Steam Support "Help with game"
 * wizard, which Valve serves for every appid Steam still knows about —
 * including the tool/demo/beta/dedicated-server/SDK subtypes that
 * IStoreService/GetAppList systematically excludes and that
 * `store.steampowered.com/api/appdetails` reports as `success=false`.
 *
 * Title format:
 *   - Known app  → "Steam Support - <name>"
 *   - Unknown    → "Steam Support" (no dash, no name)
 *
 * Different host from steamcommunity.com so it has its own rate-limit
 * bucket. Empirically covers >85% of the orphan appids that the other
 * sources miss (Source Dedicated Server, CS:S Beta, Rocksmith Demo,
 * Dota 2 Test, random Prototype apps, …).
 */
async function fetchSupportGameName(appId: number): Promise<NameFetchResult> {
  try {
    const response = await fetch(`https://help.steampowered.com/en/wizard/HelpWithGame/?appid=${appId}`, {
      cache: "no-store",
      redirect: "follow",
    })
    if (response.status === 429) return { kind: "rate_limited" }
    if (!response.ok) return { kind: "error" }
    const html = await response.text()
    const match = html.match(/<title>Steam Support - ([^<]+)<\/title>/)
    if (!match) return { kind: "empty" }
    const name = decodeBasicHtmlEntities(match[1].trim())
    if (!name) return { kind: "empty" }
    return { kind: "ok", name }
  } catch {
    return { kind: "error" }
  }
}

/**
 * Last-resort name resolver: scrape the HTML title of the Steam community
 * page for the given appid. Used for delisted achievement-less apps that
 * neither store appdetails, GetSchemaForGame nor the Support wizard can
 * name. Returns an explicit `rate_limited` result on 429 so the caller can
 * abort the community pass instead of hammering a throttled endpoint.
 *
 * Example: app 502090 ("Invisible Mind") is delisted with no schema, so the
 * structured endpoints return nothing. The community page still serves a
 * `<title>Steam Community :: Invisible Mind</title>` for it.
 */
async function fetchCommunityGameName(appId: number): Promise<NameFetchResult> {
  try {
    const response = await fetch(`https://steamcommunity.com/app/${appId}`, {
      cache: "no-store",
      redirect: "follow",
    })
    if (response.status === 429) return { kind: "rate_limited" }
    if (!response.ok) return { kind: "error" }
    const html = await response.text()
    const match = html.match(/<title>Steam Community :: ([^<]+)<\/title>/)
    if (!match) return { kind: "empty" }
    const name = decodeBasicHtmlEntities(match[1].trim())
    // Sentinel values Steam returns for unknown/invalid appids on this URL.
    if (!name || name === "Error") return { kind: "empty" }
    return { kind: "ok", name }
  } catch {
    return { kind: "error" }
  }
}

function decodeBasicHtmlEntities(s: string): string {
  // Order matters: &amp; must be replaced LAST so we don't double-decode
  // strings that contain a literal &amp; followed by another entity (e.g.
  // "&amp;#39;" should resolve to "&#39;", not "'"). CodeQL flags the
  // naive ordering as a double-unescape vulnerability.
  return s
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
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
 *
 * @param options.appIds - Restrict the pass to these extras (the regular
 *   library sync passes the appids it just ingested). An empty list is a
 *   no-op; omitting the option scans every nameless extra of the user.
 */
export async function hydrateMissingExtraNames(steamId: string, options?: { appIds?: number[] }) {
  const appIds = options?.appIds
  if (appIds && appIds.length === 0) return

  const db = getSqliteDatabase()

  // Bulk-seed `games` from the canonical Steam catalog first. This is a
  // once-per-week no-op for every user after the first, and covers the
  // entire 200k-app catalog in one shot (Tools / Software / SDK entries
  // included). The per-appid loop below becomes a safety net for the few
  // apps the catalog genuinely doesn't cover. Skipped on a restricted pass
  // (regular sync): that path must stay cheap and limited to its appids.
  if (!appIds) {
    await populateGamesFromSteamCatalog()
  }

  const allRows = db
    .prepare(
      `
      SELECT e.appid
      FROM extra_games e
      LEFT JOIN games g ON g.appid = e.appid
      WHERE e.steam_id = ?
        AND (
          g.appid IS NULL
          OR g.name IS NULL
          OR g.name = ''
          OR ${PLACEHOLDER_NAME_SQL_MATCH}
        )
        AND (g.name_source IS NULL OR g.name_source != 'manual')
      ORDER BY e.playtime_forever DESC
    `,
    )
    .all(steamId) as Array<{ appid: number }>

  // Filter in memory rather than with an IN (...) clause: a first-run
  // ingest can hand us thousands of appids, which would blow past SQLite's
  // bound-variable limit.
  const wanted = appIds ? new Set(appIds) : null
  const rows = wanted ? allRows.filter((row) => wanted.has(row.appid)) : allRows

  if (rows.length === 0) return

  const upsertGame = db.prepare(`
    INSERT INTO games (appid, name, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      name = CASE WHEN games.name_source = 'manual' THEN games.name ELSE excluded.name END,
      updated_at = excluded.updated_at
  `)

  // Store-derived kinds win over the name heuristic but never over a
  // manual override. The games row may not exist yet when the store
  // answers before any name source did; upsertGame below creates it in
  // that case, so this UPDATE is retried after the name write.
  const setStoreKind = db.prepare(`
    UPDATE games
    SET kind = ?, kind_source = 'store', updated_at = ?
    WHERE appid = ? AND (kind_source IS NULL OR kind_source != 'manual')
  `)

  const setNameKind = db.prepare(`
    UPDATE games
    SET kind = ?, kind_source = 'name', updated_at = ?
    WHERE appid = ? AND kind_source IS NULL
  `)

  let consecutiveStoreFailures = 0
  let consecutiveSupportFailures = 0
  let consecutiveCommunityFailures = 0

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
        const candidate = entry?.success && entry.data?.name ? entry.data.name : null
        // Drop placeholder names so later sources get a chance to
        // produce the real title.
        if (candidate && !isPlaceholderName(candidate)) {
          resolvedName = candidate
        }
        // The store's `type` is the most reliable classification we get;
        // record it whenever the store answers, independently of the name.
        const storeKind = entry?.success ? kindFromStoreType(entry.data?.type) : null
        if (storeKind) setStoreKind.run(storeKind, nowIso(), appid)
      }
    } catch (error) {
      consecutiveStoreFailures++
      logger.warn({ err: error, appid }, "Store appdetails call failed")
    }

    // Source 2: GetSchemaForGame (works for delisted apps the store rejects)
    if (!resolvedName) {
      try {
        const schema = await getGameSchema(appid)
        if (schema?.gameName && !isPlaceholderName(schema.gameName)) {
          resolvedName = schema.gameName
        }
      } catch {
        // non-critical
      }
    }

    // Source 3: Steam Support "Help with game" wizard. Official Valve
    // endpoint that names every appid Steam still tracks internally —
    // including tool/demo/beta/dedicated-server/SDK subtypes that
    // IStoreService/GetAppList filters out and that store appdetails
    // rejects. Different host from steamcommunity so it has an
    // independent rate-limit bucket. Skipped entirely once we see 5
    // consecutive 429/error responses to avoid hammering a throttled
    // endpoint for the rest of the run.
    if (!resolvedName && consecutiveSupportFailures < 5) {
      const result = await fetchSupportGameName(appid)
      if (result.kind === "ok") {
        // Support's HTML title is normally human-readable but apply
        // the same safety filter in case Valve ever starts echoing
        // internal placeholders through it too.
        if (!isPlaceholderName(result.name)) resolvedName = result.name
        consecutiveSupportFailures = 0
      } else if (result.kind === "empty") {
        consecutiveSupportFailures = 0
      } else {
        consecutiveSupportFailures++
      }
    }

    // Source 4: community page HTML. Kept as a final fallback — in
    // practice Steam Support already covers every case community would
    // have caught, but this leaves us resilient if Valve ever changes the
    // Support page template. Same 5-strike back-off as Support because
    // steamcommunity.com is historically the most aggressively
    // rate-limited of the three hosts.
    if (!resolvedName && consecutiveCommunityFailures < 5) {
      const result = await fetchCommunityGameName(appid)
      if (result.kind === "ok") {
        if (!isPlaceholderName(result.name)) resolvedName = result.name
        consecutiveCommunityFailures = 0
      } else if (result.kind === "empty") {
        consecutiveCommunityFailures = 0
      } else {
        consecutiveCommunityFailures++
      }
    }

    if (resolvedName) {
      const now = nowIso()
      upsertGame.run(appid, resolvedName, now, now)
      // Apply the heuristic to the freshly resolved name unless the store
      // already classified this app in this iteration.
      const nameKind = kindFromName(resolvedName)
      if (nameKind) setNameKind.run(nameKind, now, appid)
    }

    await new Promise((resolve) => setTimeout(resolve, STORE_DELAY_MS))
  }
}

/**
 * Applies the name heuristic (`kindFromName`) to the user's extras whose
 * kind is not yet known or was itself derived from the name. Store-derived
 * and manual kinds are left alone. A name that no longer matches any rule
 * resets a previous name-derived kind back to unknown, so a corrected
 * name never keeps a stale classification.
 *
 * @param appIds - Restrict to these extras (regular sync passes the ones
 *   it just ingested). Empty list is a no-op; omitted means all extras.
 */
export function classifyExtraKinds(steamId: string, appIds?: number[]): number {
  if (appIds && appIds.length === 0) return 0
  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
      SELECT g.appid, g.name, g.kind, g.kind_source
      FROM extra_games e
      INNER JOIN games g ON g.appid = e.appid
      WHERE e.steam_id = ?
        AND (g.kind_source IS NULL OR g.kind_source = 'name')
    `,
    )
    .all(steamId) as Array<{ appid: number; name: string; kind: string; kind_source: string | null }>
  const wanted = appIds ? new Set(appIds) : null
  const update = db.prepare(`UPDATE games SET kind = ?, kind_source = ?, updated_at = ? WHERE appid = ?`)
  const now = nowIso()
  let changed = 0
  db.exec("BEGIN")
  try {
    for (const row of rows) {
      if (wanted && !wanted.has(row.appid)) continue
      const next = kindFromName(row.name)
      const nextKind = next ?? "unknown"
      const nextSource = next ? "name" : null
      if (nextKind === row.kind && nextSource === row.kind_source) continue
      update.run(nextKind, nextSource, now, row.appid)
      changed++
    }
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
  return changed
}

/**
 * How `persistExtraGames` treats played-but-unowned apps that are not yet
 * in `extra_games`.
 *
 * - `full`: ingest every candidate. Used by the manual discovery action
 *   (and by anything that wants the complete picture).
 * - `incremental`: only ingest candidates played after `since` (ISO
 *   timestamp of the previous library sync). With `since = null` (profile
 *   never synced before) nothing new is ingested. Extras that already
 *   exist are always refreshed regardless of mode.
 */
export type ExtrasIngestMode = { kind: "full" } | { kind: "incremental"; since: string | null }

export type PersistExtraGamesResult = {
  /** Appids inserted into `extra_games` by this call. */
  added: number[]
  /** Appids that already existed and were refreshed by this call. */
  updated: number[]
}

/**
 * Upserts played-game rows that are NOT in the user's owned library
 * (automatically or manually owned). These surface refunded,
 * family-shared, delisted and otherwise-unowned games whose playtime Steam
 * still remembers via ClientGetLastPlayedTimes.
 *
 * Rows already present in `extra_games` are always refreshed (playtime,
 * last/first played). Which *new* rows get ingested depends on `mode`
 * (default `full`, see {@link ExtrasIngestMode}): the regular library sync
 * runs in `incremental` mode so a game played since the last sync shows up
 * on its own without paying for the bulk discovery of everything the
 * account ever launched.
 *
 * Fully isolated from `user_games` so nothing in `extra_games` can leak into
 * library stats / KPIs / insights.
 */
export function persistExtraGames(
  steamId: string,
  lastPlayed: LastPlayedGame[],
  mode: ExtrasIngestMode = { kind: "full" },
): PersistExtraGamesResult {
  const db = getSqliteDatabase()
  const result: PersistExtraGamesResult = { added: [], updated: [] }

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

  if (lastPlayed.length === 0) return result

  // Build the skip set: everything the library treats as owned, whether
  // Steam reported it or the user promoted it (owned_source = 'manual').
  const ownedRows = db.prepare(`SELECT appid FROM user_games WHERE steam_id = ? AND owned = 1`).all(steamId) as Array<{
    appid: number
  }>
  const skip = new Set(ownedRows.map((row) => row.appid))
  const existing = new Set(getExtraAppIds(steamId))

  // Incremental mode: a candidate that is not an extra yet only qualifies
  // if it was played after the previous sync. Steam reports play times in
  // unix seconds; `since` is an ISO string from steam_profile.
  const sinceSeconds =
    mode.kind === "incremental" ? (mode.since ? Math.floor(Date.parse(mode.since) / 1000) : Infinity) : -Infinity

  const candidates = lastPlayed.filter((game) => {
    if (skip.has(game.appid)) return false
    // Keep anything the account actually launched, even with zero recorded
    // minutes (old titles whose playtime Steam never counted still carry a
    // first/last timestamp). Only drop rows with no playtime *and* no play
    // timestamps: those are launcher-only touches (hover / preload).
    const played = (game.playtime_forever ?? 0) > 0 || (game.last_playtime ?? 0) > 0 || (game.first_playtime ?? 0) > 0
    if (!played) return false
    if (existing.has(game.appid)) return true
    // Inclusive: Steam reports whole seconds while `since` carries
    // milliseconds, so a session started within the sync's own second must
    // not fall through the gap.
    const playedAt = Math.max(game.last_playtime ?? 0, game.first_playtime ?? 0)
    return playedAt >= sinceSeconds
  })

  if (candidates.length === 0) return result

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
      if (existing.has(game.appid)) result.updated.push(game.appid)
      else result.added.push(game.appid)
    }
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }

  return result
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
    // Valve's Web API occasionally returns internal placeholder names
    // (ValveTestAppX, UntitledApp, InvitedPartnerAppX) for unowned-but-
    // played games; those are skipped so hydrateMissingExtraNames can
    // resolve the real name via Steam Support instead of our cache
    // permanently sticking to the placeholder.
    if (gameName && !isPlaceholderName(gameName)) {
      db.prepare(
        `
        INSERT INTO games (appid, name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(appid) DO UPDATE SET
          name = CASE WHEN games.name_source = 'manual' THEN games.name ELSE excluded.name END,
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
 * fresh and rtime_last_played hasn't advanced.
 *
 * @param options.weeklyFloor - Also re-sync rows whose achievements are
 *   older than 7 days even if rtime hasn't moved (rare edge cases where
 *   achievements unlock without a play session). Defaults to `true`; the
 *   regular library sync passes `false` so it only pays for extras that
 *   were actually played since their last sync.
 *
 * Runs per-game GetPlayerAchievements with concurrency=5.
 * Swallows per-game failures so a single broken entry can't abort the whole
 * extras sync.
 */
export async function syncExtraAchievements(steamId: string, options?: { weeklyFloor?: boolean }) {
  const weeklyFloor = options?.weeklyFloor ?? true
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
    if (weeklyFloor && isStale(row.achievements_synced_at, ACHIEVEMENTS_STALE_MS)) return true
    // Incremental: only re-sync if the game was played after our last sync.
    // Compared in whole seconds (Steam's precision), inclusively, so a play
    // that lands in the same second as the sync is not missed; the worst
    // case is one extra request for that game on the next run.
    const syncedAtSeconds = Math.floor(Date.parse(row.achievements_synced_at) / 1000)
    return (row.rtime_last_played ?? 0) >= syncedAtSeconds
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
        if (playerAchievements) {
          persistExtraAchievements(
            steamId,
            row.appid,
            playerAchievements.gameName,
            playerAchievements.achievements ?? [],
          )
          continue
        }

        // Fallback: GetPlayerAchievements refuses unowned-but-played
        // games with "Profile is not public" (even when the profile is
        // public — it's how Valve signals "you don't own this"). In
        // that case the schema endpoint still returns the full list of
        // defined achievements, so we can at least record the total
        // count. The user's actual unlocked count is unknowable via
        // the Web API here, so it stays at 0 — the UI shows "0/N (0%)"
        // instead of a bare "-", which is strictly more honest than
        // the previous "known-broken" sentinel.
        //
        // Schema responses for these apps frequently carry a placeholder
        // gameName like "ValveTestApp43110" — persistExtraAchievements
        // filters those out so the hydrate chain can resolve the real
        // name later via Steam Support.
        const schema = await getGameSchema(row.appid)
        const schemaAchievements = schema?.availableGameStats?.achievements ?? []
        if (schemaAchievements.length > 0) {
          persistExtraAchievements(
            steamId,
            row.appid,
            schema?.gameName ?? "",
            // Synthesize a placeholder achievement row per schema entry
            // with achieved=0 — persistExtraAchievements counts length
            // as total and only increments unlocked on achieved === 1.
            schemaAchievements.map((a) => ({ apiname: a.name, achieved: 0 })),
          )
          continue
        }

        // Neither endpoint knows the game — mark as broken (0/0) so we
        // don't retry on every sync. Matches the pre-fix behaviour for
        // genuinely achievement-less apps (tools, SDKs, servers).
        persistExtraAchievements(steamId, row.appid, "", [])
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
        COALESCE(g.kind, 'unknown') AS kind,
        g.kind_source,
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
        COALESCE(g.kind, 'unknown') AS kind,
        g.kind_source,
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
        ga.hidden,
        ga.global_percent,
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
    hidden: number | null
    global_percent: number | null
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
    hidden: row.hidden ?? 0,
    globalPercent: row.global_percent,
  }))
}

export type ExtrasDiscoveryResult = {
  /** ISO timestamp of when the run finished. */
  discoveredAt: string
  /** Extras that did not exist before this run. */
  added: number
  /** Extras that already existed and had their playtime refreshed. */
  updated: number
  /** Extras rows for the user after the run. */
  total: number
}

export type ExtrasDiscoveryStatus = {
  running: boolean
  lastDiscoveryAt: string | null
}

// Per-user in-flight promise. A second request while a run is in progress
// joins it instead of starting another bulk pass against Steam.
const discoveryInflight = new Map<string, Promise<ExtrasDiscoveryResult>>()

/** True while a manual extras discovery is running for this user in this process. */
export function isExtrasDiscoveryRunning(steamId: string): boolean {
  return discoveryInflight.has(steamId)
}

/** Running flag plus the timestamp of the user's last completed discovery. */
export function getExtrasDiscoveryStatus(steamId: string): ExtrasDiscoveryStatus {
  upsertProfile(steamId)
  return {
    running: isExtrasDiscoveryRunning(steamId),
    lastDiscoveryAt: getProfileSync(steamId)?.last_extras_discovery_at ?? null,
  }
}

/**
 * Manual, explicit bulk discovery of extras: everything the account ever
 * launched that is not in the owned library. This is the expensive pass the
 * regular sync no longer runs (see `persistExtraGames` incremental mode):
 * full ingest, achievements with the weekly staleness floor, name hydration
 * for every nameless extra, and image probes.
 *
 * Concurrent calls for the same user share one run.
 */
export async function discoverExtraGames(steamId: string): Promise<ExtrasDiscoveryResult> {
  const existing = discoveryInflight.get(steamId)
  if (existing) return existing

  const run = runExtrasDiscovery(steamId).finally(() => {
    discoveryInflight.delete(steamId)
  })
  discoveryInflight.set(steamId, run)
  return run
}

async function runExtrasDiscovery(steamId: string): Promise<ExtrasDiscoveryResult> {
  const startedAt = Date.now()
  upsertProfile(steamId)
  logger.info({ steamId }, "Extras discovery: start")

  const lastPlayed = await getLastPlayedTimes(steamId)
  const ingest = persistExtraGames(steamId, lastPlayed, { kind: "full" })
  logger.info(
    { steamId, lastPlayed: lastPlayed.length, added: ingest.added.length, updated: ingest.updated.length },
    "Extras discovery: ingested",
  )

  await syncExtraAchievements(steamId, { weeklyFloor: true })
  await hydrateMissingExtraNames(steamId)
  classifyExtraKinds(steamId)
  await ensureGameImages(getExtraAppIds(steamId))

  const discoveredAt = nowIso()
  markProfileSync(steamId, "last_extras_discovery_at", discoveredAt)
  const total = getExtraAppIds(steamId).length
  logger.info({ steamId, total, elapsedMs: Date.now() - startedAt }, "Extras discovery: done")

  return { discoveredAt, added: ingest.added.length, updated: ingest.updated.length, total }
}

/**
 * User override of an extra's kind. `kind = null` clears the override:
 * the row goes back to unclassified and the name heuristic is re-applied
 * immediately (a later store answer may upgrade it to 'store').
 *
 * The kind lives on the shared `games` row, so the override is global
 * (a demo is a demo for everyone); the caller restricts it to apps that
 * are among the user's extras.
 *
 * @returns The refreshed extra, or null when the app is not one of the
 *   user's extras.
 */
export function setExtraKind(steamId: string, appId: number, kind: AppKind | null): ExtraGame | null {
  const db = getSqliteDatabase()
  if (!getStoredExtraGame(steamId, appId)) return null

  const now = nowIso()
  // The games row may be absent for a nameless extra; create it so the
  // override has somewhere to live.
  db.prepare(`INSERT OR IGNORE INTO games (appid, name, created_at, updated_at) VALUES (?, '', ?, ?)`).run(
    appId,
    now,
    now,
  )
  if (kind) {
    db.prepare(`UPDATE games SET kind = ?, kind_source = 'manual', updated_at = ? WHERE appid = ?`).run(
      kind,
      now,
      appId,
    )
  } else {
    db.prepare(`UPDATE games SET kind = 'unknown', kind_source = NULL, updated_at = ? WHERE appid = ?`).run(now, appId)
    classifyExtraKinds(steamId, [appId])
  }
  return getStoredExtraGame(steamId, appId)
}
