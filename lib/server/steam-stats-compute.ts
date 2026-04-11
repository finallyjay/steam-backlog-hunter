import "server-only"

import type { SteamStatsResponse } from "@/lib/types/steam"
import { getTopAchievementsForGames } from "@/lib/steam-api"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { isStale, upsertProfile, getProfileSync, roundPercent } from "@/lib/server/steam-store-utils"
import { ensureOwnedGamesSynced, getRecentlyPlayedGamesForUser } from "@/lib/server/steam-games-sync"
import { logger } from "@/lib/server/logger"
import {
  ACHIEVEMENTS_STALE_MS,
  getStoredAchievements,
  persistBulkGameStats,
} from "@/lib/server/steam-achievements-sync"

export const OWNED_GAMES_STALE_MS = 24 * 60 * 60 * 1000
const STATS_STALE_MS = 15 * 60 * 1000
const BULK_ACHIEVEMENTS_BATCH_SIZE = 100

type StatsSnapshotRow = {
  total_games: number
  total_achievements: number
  pending_achievements: number
  started_games: number
  library_average_completion: number
  total_playtime_minutes: number
  perfect_games: number
  computed_at: string
}

function computeStatsFromDatabase(steamId: string): SteamStatsResponse {
  const db = getSqliteDatabase()
  const totals = db
    .prepare(
      `
    SELECT
      COUNT(*) AS total_games,
      COALESCE(SUM(playtime_forever), 0) AS total_playtime_minutes
    FROM user_games ug
    WHERE ug.steam_id = ? AND ug.owned = 1
      AND NOT EXISTS (SELECT 1 FROM hidden_games hg WHERE hg.steam_id = ug.steam_id AND hg.appid = ug.appid)
  `,
    )
    .get(steamId) as { total_games: number; total_playtime_minutes: number }

  const achievementTotals = db
    .prepare(
      `
    SELECT
      COUNT(*) AS games_with_achievements,
      COALESCE(SUM(unlocked_count), 0) AS total_achievements,
      COALESCE(SUM(CASE WHEN total_count > unlocked_count THEN total_count - unlocked_count ELSE 0 END), 0) AS pending_achievements,
      COALESCE(SUM(CASE WHEN unlocked_count > 0 THEN 1 ELSE 0 END), 0) AS started_games,
      COALESCE(SUM(perfect_game), 0) AS perfect_games
    FROM user_games ug
    WHERE ug.steam_id = ? AND ug.owned = 1 AND ug.total_count > 0
      AND NOT EXISTS (SELECT 1 FROM hidden_games hg WHERE hg.steam_id = ug.steam_id AND hg.appid = ug.appid)
  `,
    )
    .get(steamId) as {
    games_with_achievements: number
    total_achievements: number
    pending_achievements: number
    started_games: number
    perfect_games: number
  }

  const libraryAverageRow = db
    .prepare(
      `
    SELECT AVG(CAST(unlocked_count AS REAL) / total_count) * 100 AS average_completion
    FROM user_games ug
    WHERE ug.steam_id = ? AND ug.owned = 1 AND ug.total_count > 0 AND ug.unlocked_count > 0
      AND NOT EXISTS (SELECT 1 FROM hidden_games hg WHERE hg.steam_id = ug.steam_id AND hg.appid = ug.appid)
  `,
    )
    .get(steamId) as { average_completion: number | null }

  return {
    totalGames: totals.total_games ?? 0,
    gamesWithAchievements: achievementTotals.games_with_achievements ?? 0,
    totalAchievements: achievementTotals.total_achievements ?? 0,
    pendingAchievements: achievementTotals.pending_achievements ?? 0,
    startedGames: achievementTotals.started_games ?? 0,
    averageCompletion: roundPercent(libraryAverageRow.average_completion ?? 0),
    totalPlaytime: Number(((totals.total_playtime_minutes ?? 0) / 60).toFixed(1)),
    perfectGames: achievementTotals.perfect_games ?? 0,
  }
}

function persistStatsSnapshot(steamId: string, stats: SteamStatsResponse) {
  const db = getSqliteDatabase()
  const now = new Date().toISOString()
  db.prepare(
    `
    INSERT INTO stats_snapshot (
      steam_id,
      total_games,
      total_achievements,
      pending_achievements,
      started_games,
      library_average_completion,
      total_playtime_minutes,
      perfect_games,
      computed_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(steam_id) DO UPDATE SET
      total_games = excluded.total_games,
      total_achievements = excluded.total_achievements,
      pending_achievements = excluded.pending_achievements,
      started_games = excluded.started_games,
      library_average_completion = excluded.library_average_completion,
      total_playtime_minutes = excluded.total_playtime_minutes,
      perfect_games = excluded.perfect_games,
      computed_at = excluded.computed_at,
      updated_at = excluded.updated_at
  `,
  ).run(
    steamId,
    stats.totalGames,
    stats.totalAchievements,
    stats.pendingAchievements,
    stats.startedGames,
    stats.averageCompletion,
    Math.round(stats.totalPlaytime * 60),
    stats.perfectGames,
    now,
    now,
  )
}

/** Retrieves the most recent stats snapshot from the database. */
export function getStoredStatsSnapshot(steamId: string) {
  const db = getSqliteDatabase()
  return db
    .prepare(
      `
    SELECT total_games, total_achievements, pending_achievements, started_games, library_average_completion, total_playtime_minutes, perfect_games, computed_at
    FROM stats_snapshot
    WHERE steam_id = ?
  `,
    )
    .get(steamId) as StatsSnapshotRow | undefined
}

async function syncAchievementsForStats(steamId: string, forceRefresh: boolean) {
  const ownedGames = await ensureOwnedGamesSynced(steamId, { forceRefresh })

  // Candidate set: games with community stats that aren't already known-broken
  // (synced once and confirmed to have 0 achievements), and whose stored
  // unlock state is either missing or stale.
  const stale = ownedGames.filter((game) => {
    if (!game.has_community_visible_stats) return false
    const stored = getStoredAchievements(steamId, game.appid)
    if (stored?.achievements_synced_at && (stored.total_count ?? 0) === 0) return false
    if (!forceRefresh && stored && !isStale(stored.achievements_synced_at, ACHIEVEMENTS_STALE_MS)) {
      return false
    }
    return true
  })

  if (stale.length === 0) return

  // Batch stale games into the undocumented GetTopAchievementsForGames
  // endpoint (~100 games per HTTP call). For 1000-game libraries this
  // collapses ~1000 per-game GetPlayerAchievements calls into ~10 bulk calls.
  for (let index = 0; index < stale.length; index += BULK_ACHIEVEMENTS_BATCH_SIZE) {
    const chunk = stale.slice(index, index + BULK_ACHIEVEMENTS_BATCH_SIZE)
    const requestedAppIds = new Set(chunk.map((game) => game.appid))

    let games: Awaited<ReturnType<typeof getTopAchievementsForGames>>
    try {
      games = await getTopAchievementsForGames(
        steamId,
        chunk.map((game) => game.appid),
      )
    } catch (error) {
      logger.warn(
        { err: error, batchSize: chunk.length },
        "Bulk achievements batch failed — stale games will retry on next sync",
      )
      continue
    }

    const seen = new Set<number>()
    for (const game of games) {
      if (!requestedAppIds.has(game.appid)) continue
      seen.add(game.appid)
      const unlockedApinames = (game.achievements ?? [])
        .map((achievement) => achievement.name ?? "")
        .filter((name) => name.length > 0)
      persistBulkGameStats(steamId, game.appid, game.total_achievements ?? 0, unlockedApinames)
    }

    // Games in the batch that the endpoint silently dropped — mark nothing;
    // they'll be retried on the next sync.
    const missing = chunk.filter((game) => !seen.has(game.appid))
    if (missing.length > 0) {
      logger.debug(
        { missingCount: missing.length, batchStart: index },
        "Bulk achievements response omitted games — will retry next sync",
      )
    }
  }
}

/**
 * Computes aggregate stats for a user (games, achievements, playtime, completion).
 * Returns a cached snapshot if fresh, otherwise syncs achievements and recomputes.
 */
export async function getStatsForUser(steamId: string, options?: { forceRefresh?: boolean }) {
  const forceRefresh = options?.forceRefresh ?? false
  await ensureOwnedGamesSynced(steamId, { forceRefresh })

  const snapshot = getStoredStatsSnapshot(steamId)
  if (!forceRefresh && snapshot && !isStale(snapshot.computed_at, STATS_STALE_MS)) {
    const db = getSqliteDatabase()
    const achCount = db
      .prepare(
        "SELECT COUNT(*) as c FROM user_games ug WHERE ug.steam_id = ? AND ug.owned = 1 AND ug.total_count > 0 AND NOT EXISTS (SELECT 1 FROM hidden_games hg WHERE hg.steam_id = ug.steam_id AND hg.appid = ug.appid)",
      )
      .get(steamId) as { c: number }
    return {
      totalGames: snapshot.total_games,
      gamesWithAchievements: achCount.c,
      totalAchievements: snapshot.total_achievements,
      pendingAchievements: snapshot.pending_achievements,
      startedGames: snapshot.started_games,
      averageCompletion: snapshot.library_average_completion,
      totalPlaytime: Number((snapshot.total_playtime_minutes / 60).toFixed(1)),
      perfectGames: snapshot.perfect_games,
    }
  }

  await syncAchievementsForStats(steamId, forceRefresh)
  const stats = computeStatsFromDatabase(steamId)
  persistStatsSnapshot(steamId, stats)

  return stats
}

/** Returns timestamps of the last sync operations for games, recent games, and stats. */
export function getUserSyncStatus(steamId: string) {
  upsertProfile(steamId)
  const profileSync = getProfileSync(steamId)
  const statsSnapshot = getStoredStatsSnapshot(steamId)

  return {
    lastOwnedGamesSyncAt: profileSync?.last_owned_games_sync_at ?? null,
    lastRecentGamesSyncAt: profileSync?.last_recent_games_sync_at ?? null,
    lastStatsSyncAt: statsSnapshot?.computed_at ?? null,
  }
}

/** Force-refreshes all user data: owned games, recent games, and stats. */
export async function synchronizeUserData(steamId: string) {
  const ownedGames = await ensureOwnedGamesSynced(steamId, { forceRefresh: true })
  const recentGames = await getRecentlyPlayedGamesForUser(steamId, { forceRefresh: true })
  const stats = await getStatsForUser(steamId, { forceRefresh: true })

  return {
    syncedAt: new Date().toISOString(),
    ownedGames: ownedGames.length,
    recentGames: recentGames.length,
    stats,
  }
}
