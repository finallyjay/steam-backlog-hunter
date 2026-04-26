import "server-only"

import { getLastPlayedTimes, getOwnedGames, type LastPlayedGame, type SteamGame } from "@/lib/steam-api"
import { ensureGameImages } from "@/lib/server/steam-images"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { ensurePinnedGamesSynced } from "@/lib/server/pinned-games"
import {
  getExtraAppIds,
  hydrateMissingExtraNames,
  persistExtraGames,
  syncExtraAchievements,
} from "@/lib/server/extra-games"
import { syncGamePlatforms } from "@/lib/server/steam-platforms-sync"
import { isPlaceholderName } from "@/lib/server/placeholder-names"
import { logger } from "@/lib/server/logger"
import {
  nowIso,
  nullIfUndefined,
  isStale,
  upsertProfile,
  markProfileSync,
  getProfileSync,
} from "@/lib/server/steam-store-utils"

const OWNED_GAMES_STALE_MS = 24 * 60 * 60 * 1000
export const RECENT_GAMES_LIMIT = 25

export type GameRow = {
  appid: number
  name: string
  playtime_forever: number
  playtime_2weeks: number | null
  rtime_last_played: number | null
  rtime_first_played: number | null
  img_icon_url: string | null
  img_logo_url: string | null
  image_icon_url: string | null
  image_landscape_url: string | null
  image_portrait_url: string | null
  has_community_visible_stats: number | null
  unlocked_count: number | null
  total_count: number | null
  perfect_game: number | null
  platforms: string | null
  release_year: number | null
}

function parsePlatforms(raw: string | null): SteamGame["platforms"] {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { windows?: unknown; mac?: unknown; linux?: unknown }
    return {
      windows: Boolean(parsed.windows),
      mac: Boolean(parsed.mac),
      linux: Boolean(parsed.linux),
    }
  } catch {
    return null
  }
}

/** Converts a SQLite game row into a SteamGame object. */
export function mapRowToSteamGame(row: GameRow): SteamGame {
  return {
    appid: row.appid,
    name: row.name,
    playtime_forever: row.playtime_forever,
    playtime_2weeks: row.playtime_2weeks ?? undefined,
    rtime_last_played: row.rtime_last_played ?? undefined,
    rtime_first_played: row.rtime_first_played ?? undefined,
    img_icon_url: row.img_icon_url ?? "",
    img_logo_url: row.img_logo_url ?? "",
    image_icon_url: row.image_icon_url ?? undefined,
    image_landscape_url: row.image_landscape_url ?? undefined,
    image_portrait_url: row.image_portrait_url ?? undefined,
    has_community_visible_stats:
      row.has_community_visible_stats === null ? undefined : row.has_community_visible_stats === 1,
    unlocked_count: row.unlocked_count ?? undefined,
    total_count: row.total_count ?? undefined,
    perfect_game: row.perfect_game === 1,
    platforms: parsePlatforms(row.platforms),
    releaseYear: row.release_year,
  }
}

/** Retrieves all owned games for a user from the local SQLite database. */
export function getStoredOwnedGames(steamId: string): SteamGame[] {
  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
    SELECT
      ug.appid,
      g.name,
      ug.playtime_forever,
      ug.playtime_2weeks,
      ug.rtime_last_played,
      ug.rtime_first_played,
      g.icon_hash AS img_icon_url,
      g.logo_hash AS img_logo_url,
      g.image_icon_url,
      g.image_landscape_url,
      g.image_portrait_url,
      g.has_community_visible_stats,
      ug.unlocked_count,
      ug.total_count,
      ug.perfect_game,
      g.platforms,
      g.release_year
    FROM user_games ug
    INNER JOIN games g ON g.appid = ug.appid
    WHERE ug.steam_id = ? AND ug.owned = 1
      AND NOT EXISTS (SELECT 1 FROM hidden_games hg WHERE hg.steam_id = ug.steam_id AND hg.appid = ug.appid)
    ORDER BY LOWER(g.name) ASC
  `,
    )
    .all(steamId) as GameRow[]

  return rows.map(mapRowToSteamGame)
}

/** Retrieves a single owned game by app ID from the local database, or null if not found. */
export function getStoredGame(steamId: string, appId: number): SteamGame | null {
  const db = getSqliteDatabase()
  const row = db
    .prepare(
      `
    SELECT
      ug.appid,
      g.name,
      ug.playtime_forever,
      ug.playtime_2weeks,
      ug.rtime_last_played,
      ug.rtime_first_played,
      g.icon_hash AS img_icon_url,
      g.logo_hash AS img_logo_url,
      g.image_icon_url,
      g.image_landscape_url,
      g.image_portrait_url,
      g.has_community_visible_stats,
      g.platforms,
      g.release_year
    FROM user_games ug
    INNER JOIN games g ON g.appid = ug.appid
    WHERE ug.steam_id = ? AND ug.appid = ? AND ug.owned = 1
      AND NOT EXISTS (SELECT 1 FROM hidden_games hg WHERE hg.steam_id = ug.steam_id AND hg.appid = ug.appid)
  `,
    )
    .get(steamId, appId) as GameRow | undefined

  return row ? mapRowToSteamGame(row) : null
}

/** Persists a full list of owned games to SQLite, marking missing games as unowned. */
export function persistOwnedGames(steamId: string, games: SteamGame[]) {
  const db = getSqliteDatabase()
  const now = nowIso()
  upsertProfile(steamId)

  const insertGame = db.prepare(`
    INSERT INTO games (
      appid,
      name,
      icon_hash,
      logo_hash,
      has_community_visible_stats,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      name = CASE WHEN games.name_source = 'manual' THEN games.name ELSE excluded.name END,
      icon_hash = excluded.icon_hash,
      logo_hash = excluded.logo_hash,
      has_community_visible_stats = excluded.has_community_visible_stats,
      updated_at = excluded.updated_at
  `)

  const insertUserGame = db.prepare(`
    INSERT INTO user_games (
      steam_id,
      appid,
      playtime_forever,
      playtime_2weeks,
      rtime_last_played,
      owned,
      last_seen_in_owned_games_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(steam_id, appid) DO UPDATE SET
      playtime_forever = excluded.playtime_forever,
      playtime_2weeks = excluded.playtime_2weeks,
      rtime_last_played = excluded.rtime_last_played,
      owned = 1,
      last_seen_in_owned_games_at = excluded.last_seen_in_owned_games_at,
      updated_at = excluded.updated_at
  `)

  const markMissingAsUnowned = db.prepare(`
    UPDATE user_games
    SET owned = 0, updated_at = ?
    WHERE steam_id = ?
  `)

  db.exec("BEGIN")

  try {
    markMissingAsUnowned.run(now, steamId)

    for (const game of games) {
      // Valve occasionally returns internal placeholder names here too
      // (ValveTestAppX, etc) for partner-uploaded entries. Persist an
      // empty string instead so hydrateMissingExtraNames' WHERE —
      // which also matches empty names — resolves the real title via
      // the Steam Support chain on the next sync tick.
      const safeName = isPlaceholderName(game.name) ? "" : game.name
      insertGame.run(
        game.appid,
        safeName,
        nullIfUndefined(game.img_icon_url),
        nullIfUndefined(game.img_logo_url),
        typeof game.has_community_visible_stats === "boolean" ? Number(game.has_community_visible_stats) : null,
        now,
        now,
      )

      insertUserGame.run(
        steamId,
        game.appid,
        game.playtime_forever,
        nullIfUndefined(game.playtime_2weeks),
        nullIfUndefined(game.rtime_last_played),
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

  markProfileSync(steamId, "last_owned_games_sync_at", now)
}

/**
 * Ensures owned games are synced from the Steam API, fetching fresh data if stale.
 *
 * @param options.forceRefresh - Skip staleness check and always fetch from Steam API
 * @returns The user's owned games list
 */
/**
 * Enriches every user_games row that matches an entry in the
 * ClientGetLastPlayedTimes response with its real playtime_forever,
 * rtime_last_played and rtime_first_played. Rows not present in the
 * response are untouched.
 *
 * The endpoint returns every game the account has ever played, including
 * delisted ones (FaceRig, Free to Play, …) that GetOwnedGames hides, so
 * pinned games finally get a real playtime instead of the 0 we write
 * during upsertPinned. It also gives us first_playtime, which isn't
 * exposed anywhere else in the Web API.
 */
export function persistLastPlayedTimes(steamId: string, games: LastPlayedGame[]) {
  if (games.length === 0) return

  const db = getSqliteDatabase()
  const now = nowIso()
  const update = db.prepare(
    `UPDATE user_games
     SET playtime_forever = ?,
         rtime_last_played = COALESCE(?, rtime_last_played),
         rtime_first_played = COALESCE(?, rtime_first_played),
         updated_at = ?
     WHERE steam_id = ? AND appid = ?`,
  )

  for (const game of games) {
    if (game.playtime_forever === undefined) continue
    update.run(
      game.playtime_forever,
      nullIfUndefined(game.last_playtime),
      nullIfUndefined(game.first_playtime),
      now,
      steamId,
      game.appid,
    )
  }
}

// Per-user in-flight promise for the heavy owned-games pipeline. Any
// concurrent caller (POST /api/steam/sync + a GET /api/steam/games fired
// by the UI on the same click) joins the same Promise instead of kicking
// off a second extras/hydrate/images pass. Cleared in a finally so a
// failed sync doesn't poison subsequent attempts.
const heavyOwnedGamesSyncInflight = new Map<string, Promise<SteamGame[]>>()

async function runHeavyOwnedGamesSync(steamId: string, existingGames: SteamGame[]): Promise<SteamGame[]> {
  const games = await getOwnedGames(steamId)

  // Guard against transient Steam API failures: if GetOwnedGames returned
  // empty but we already had a populated library last time, it's almost
  // certainly a blip (rate limit, 5xx, network flap) and NOT the user
  // refunding every game in their catalog. persistOwnedGames' markMissing
  // sweep would otherwise flip every owned row to owned=0, which later
  // dumps them all into extras. Preserve the existing state and bail.
  if (games.length === 0 && existingGames.length > 0) {
    logger.warn(
      { steamId, existingCount: existingGames.length },
      "GetOwnedGames returned empty but user already had a populated library — preserving existing rows",
    )
    await ensureGameImages(existingGames.map((game) => game.appid))
    return existingGames
  }

  persistOwnedGames(steamId, games)
  // Resolve pinned (delisted) games after the main upsert so persistOwnedGames'
  // markMissingAsUnowned sweep can't flip them back to owned=0.
  await ensurePinnedGamesSynced(steamId, new Set(games.map((game) => game.appid)))
  // Enrich every matched row with real playtime + first_playtime from the
  // client-side "last played times" log. Pinned games benefit most from
  // this (they arrive with playtime=0), but every owned game also gets a
  // first_playtime value that GetOwnedGames never exposes.
  const lastPlayed = await getLastPlayedTimes(steamId)
  persistLastPlayedTimes(steamId, lastPlayed)
  // Everything in lastPlayed that ISN'T already in user_games (owned + pinned)
  // lands in extra_games — refunded, family-shared, delisted-but-not-pinned,
  // etc. Fully isolated from library stats.
  persistExtraGames(steamId, lastPlayed)
  // Fetch achievements + names for extras so the Extras page has the same
  // level of detail as the Library. GetPlayerAchievements.gameName is the
  // authoritative name source for apps with achievements (delisted or not).
  await syncExtraAchievements(steamId)
  // Fallback pass: hydrate names for extras that are still nameless after
  // the achievement sync — typically live apps without any Steam
  // achievements (dedicated servers, demos, retired betas) where
  // GetPlayerAchievements has nothing to return. Uses the public store
  // appdetails endpoint. Truly delisted no-achievement apps stay nameless
  // and render as "App #{appid}".
  await hydrateMissingExtraNames(steamId)
  // Probe store appdetails for platform support (windows/mac/linux). Used by
  // the UI to disambiguate same-named games across editions (e.g. GTA III
  // Mac vs Windows). Throttled to 200 fetches per run with a 30-day
  // staleness floor, so steady-state cost is essentially zero.
  await syncGamePlatforms(steamId)
  const finalGames = getStoredOwnedGames(steamId)
  // Image probes: both owned and extras share the `games` cache, so running
  // ensureGameImages across the union fills in headers/portraits for every
  // game that appears in the UI.
  const extraAppIds = getExtraAppIds(steamId)
  const imageAppIds = Array.from(new Set([...finalGames.map((g) => g.appid), ...extraAppIds]))
  await ensureGameImages(imageAppIds)
  return finalGames
}

export async function ensureOwnedGamesSynced(steamId: string, options?: { forceRefresh?: boolean }) {
  const forceRefresh = options?.forceRefresh ?? false
  upsertProfile(steamId)

  const syncInfo = getProfileSync(steamId)
  const shouldRefresh = forceRefresh || isStale(syncInfo?.last_owned_games_sync_at, OWNED_GAMES_STALE_MS)
  const existingGames = getStoredOwnedGames(steamId)

  if (!shouldRefresh && existingGames.length > 0) {
    await ensureGameImages(existingGames.map((game) => game.appid))
    return existingGames
  }

  // Dedupe concurrent heavy syncs for the same user. Without this, a POST
  // /api/steam/sync and a GET /api/steam/games fired from the same UI click
  // both see the DB as unsynced and each runs the full pipeline in parallel.
  const existing = heavyOwnedGamesSyncInflight.get(steamId)
  if (existing) return existing

  const promise = runHeavyOwnedGamesSync(steamId, existingGames)
  heavyOwnedGamesSyncInflight.set(steamId, promise)
  try {
    return await promise
  } finally {
    heavyOwnedGamesSyncInflight.delete(steamId)
  }
}

/** Returns all owned games for a user, syncing from Steam if needed. */
export async function getOwnedGamesForUser(steamId: string, options?: { forceRefresh?: boolean }) {
  return ensureOwnedGamesSynced(steamId, options)
}

/** Returns recently played games for a user, ordered by last played time descending. */
export async function getRecentlyPlayedGamesForUser(steamId: string, options?: { forceRefresh?: boolean }) {
  await ensureOwnedGamesSynced(steamId, options)

  const db = getSqliteDatabase()
  const rows = db
    .prepare(
      `
    SELECT
      ug.appid,
      g.name,
      ug.playtime_forever,
      ug.playtime_2weeks,
      ug.rtime_last_played,
      ug.rtime_first_played,
      g.icon_hash AS img_icon_url,
      g.logo_hash AS img_logo_url,
      g.image_icon_url,
      g.image_landscape_url,
      g.image_portrait_url,
      g.has_community_visible_stats,
      ug.unlocked_count,
      ug.total_count,
      ug.perfect_game,
      g.platforms,
      g.release_year
    FROM user_games ug
    INNER JOIN games g ON g.appid = ug.appid
    WHERE ug.steam_id = ? AND ug.owned = 1 AND ug.rtime_last_played > 0
      AND NOT EXISTS (SELECT 1 FROM hidden_games hg WHERE hg.steam_id = ug.steam_id AND hg.appid = ug.appid)
    ORDER BY ug.rtime_last_played DESC
    LIMIT ${RECENT_GAMES_LIMIT}
  `,
    )
    .all(steamId) as GameRow[]

  return rows.map(mapRowToSteamGame)
}

/** Returns a single game for a user, syncing owned games first if needed. */
export async function getStoredGameForUser(steamId: string, appId: number, options?: { forceRefresh?: boolean }) {
  await ensureOwnedGamesSynced(steamId, options)
  return getStoredGame(steamId, appId)
}
