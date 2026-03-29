import "server-only"

import { getTrackedGameIdsServer } from "@/lib/server/tracked-games"
import type { SteamStatsResponse } from "@/lib/types/steam"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { isStale, upsertProfile, getProfileSync, roundPercent } from "@/lib/server/steam-store-utils"
import { ensureOwnedGamesSynced, getRecentlyPlayedGamesForUser } from "@/lib/server/steam-games-sync"
import {
  ACHIEVEMENTS_STALE_MS,
  getStoredAchievements,
  getAchievementsForGame,
} from "@/lib/server/steam-achievements-sync"

export const OWNED_GAMES_STALE_MS = 24 * 60 * 60 * 1000
const STATS_STALE_MS = 15 * 60 * 1000
const ACHIEVEMENTS_CONCURRENCY = 8

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

function computeStatsFromDatabase(steamId: string, allowedIds: Set<string>): SteamStatsResponse {
  const db = getSqliteDatabase()
  const totals = db
    .prepare(
      `
    SELECT
      COUNT(*) AS total_games,
      COALESCE(SUM(playtime_forever), 0) AS total_playtime_minutes
    FROM user_games
    WHERE steam_id = ? AND owned = 1
  `,
    )
    .get(steamId) as { total_games: number; total_playtime_minutes: number }

  const allowedAppIds = Array.from(allowedIds).map((id) => Number(id))
  const achievementTotals =
    allowedAppIds.length > 0
      ? (db
          .prepare(
            `
        SELECT
          COALESCE(SUM(unlocked_count), 0) AS total_achievements,
          COALESCE(SUM(CASE WHEN total_count > unlocked_count THEN total_count - unlocked_count ELSE 0 END), 0) AS pending_achievements,
          COALESCE(SUM(CASE WHEN unlocked_count > 0 THEN 1 ELSE 0 END), 0) AS started_games,
          COALESCE(SUM(perfect_game), 0) AS perfect_games
        FROM user_games
        WHERE steam_id = ? AND owned = 1 AND appid IN (${allowedAppIds.map(() => "?").join(",")})
      `,
          )
          .get(steamId, ...allowedAppIds) as {
          total_achievements: number
          pending_achievements: number
          started_games: number
          perfect_games: number
        })
      : {
          total_achievements: 0,
          pending_achievements: 0,
          started_games: 0,
          perfect_games: 0,
        }

  const libraryAverageRow = db
    .prepare(
      `
    SELECT AVG(CAST(unlocked_count AS REAL) / total_count) * 100 AS average_completion
    FROM user_games
    WHERE steam_id = ? AND owned = 1 AND total_count > 0 AND unlocked_count > 0
  `,
    )
    .get(steamId) as { average_completion: number | null }

  return {
    totalGames: totals.total_games ?? 0,
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
  const allowedIds = await getTrackedGameIdsServer(steamId)
  const ownedGames = await ensureOwnedGamesSynced(steamId, { forceRefresh })
  const candidateGames = ownedGames.filter((game) => allowedIds.has(String(game.appid)))

  for (let index = 0; index < candidateGames.length; index += ACHIEVEMENTS_CONCURRENCY) {
    const chunk = candidateGames.slice(index, index + ACHIEVEMENTS_CONCURRENCY)
    await Promise.allSettled(
      chunk.map(async (game) => {
        const storedAchievements = getStoredAchievements(steamId, game.appid)
        if (
          !forceRefresh &&
          storedAchievements &&
          !isStale(storedAchievements.achievements_synced_at, ACHIEVEMENTS_STALE_MS)
        ) {
          return
        }

        await getAchievementsForGame(steamId, game.appid, { forceRefresh })
      }),
    )
  }

  return allowedIds
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
    return {
      totalGames: snapshot.total_games,
      totalAchievements: snapshot.total_achievements,
      pendingAchievements: snapshot.pending_achievements,
      startedGames: snapshot.started_games,
      averageCompletion: snapshot.library_average_completion,
      totalPlaytime: Number((snapshot.total_playtime_minutes / 60).toFixed(1)),
      perfectGames: snapshot.perfect_games,
    }
  }

  const allowedIds = await syncAchievementsForStats(steamId, forceRefresh)
  const stats = computeStatsFromDatabase(steamId, allowedIds)
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
