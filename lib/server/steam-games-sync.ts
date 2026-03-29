import "server-only"

import { getOwnedGames, type SteamGame } from "@/lib/steam-api"
import { ensureGameImages } from "@/lib/server/steam-images"
import { getSqliteDatabase } from "@/lib/server/sqlite"
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
  img_icon_url: string | null
  img_logo_url: string | null
  image_icon_url: string | null
  image_landscape_url: string | null
  image_portrait_url: string | null
  has_community_visible_stats: number | null
}

export function mapRowToSteamGame(row: GameRow): SteamGame {
  return {
    appid: row.appid,
    name: row.name,
    playtime_forever: row.playtime_forever,
    playtime_2weeks: row.playtime_2weeks ?? undefined,
    rtime_last_played: row.rtime_last_played ?? undefined,
    img_icon_url: row.img_icon_url ?? "",
    img_logo_url: row.img_logo_url ?? "",
    image_icon_url: row.image_icon_url ?? undefined,
    image_landscape_url: row.image_landscape_url ?? undefined,
    image_portrait_url: row.image_portrait_url ?? undefined,
    has_community_visible_stats:
      row.has_community_visible_stats === null ? undefined : row.has_community_visible_stats === 1,
  }
}

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
      g.icon_hash AS img_icon_url,
      g.logo_hash AS img_logo_url,
      g.image_icon_url,
      g.image_landscape_url,
      g.image_portrait_url,
      g.has_community_visible_stats
    FROM user_games ug
    INNER JOIN games g ON g.appid = ug.appid
    WHERE ug.steam_id = ? AND ug.owned = 1
    ORDER BY LOWER(g.name) ASC
  `,
    )
    .all(steamId) as GameRow[]

  return rows.map(mapRowToSteamGame)
}

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
      g.icon_hash AS img_icon_url,
      g.logo_hash AS img_logo_url,
      g.image_icon_url,
      g.image_landscape_url,
      g.image_portrait_url,
      g.has_community_visible_stats
    FROM user_games ug
    INNER JOIN games g ON g.appid = ug.appid
    WHERE ug.steam_id = ? AND ug.appid = ? AND ug.owned = 1
  `,
    )
    .get(steamId, appId) as GameRow | undefined

  return row ? mapRowToSteamGame(row) : null
}

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
      name = excluded.name,
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
      insertGame.run(
        game.appid,
        game.name,
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

  const games = await getOwnedGames(steamId)
  persistOwnedGames(steamId, games)
  await ensureGameImages(games.map((game) => game.appid))
  return getStoredOwnedGames(steamId)
}

export async function getOwnedGamesForUser(steamId: string, options?: { forceRefresh?: boolean }) {
  return ensureOwnedGamesSynced(steamId, options)
}

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
      g.icon_hash AS img_icon_url,
      g.logo_hash AS img_logo_url,
      g.image_icon_url,
      g.image_landscape_url,
      g.image_portrait_url,
      g.has_community_visible_stats
    FROM user_games ug
    INNER JOIN games g ON g.appid = ug.appid
    WHERE ug.steam_id = ? AND ug.owned = 1 AND ug.rtime_last_played > 0
    ORDER BY ug.rtime_last_played DESC
    LIMIT ${RECENT_GAMES_LIMIT}
  `,
    )
    .all(steamId) as GameRow[]

  return rows.map(mapRowToSteamGame)
}

export async function getStoredGameForUser(steamId: string, appId: number, options?: { forceRefresh?: boolean }) {
  await ensureOwnedGamesSynced(steamId, options)
  return getStoredGame(steamId, appId)
}
