import "server-only"

import type { SteamStatsResponse } from "@/lib/types/steam"
import { getPlayerAchievements } from "@/lib/steam-api"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { isStale, upsertProfile, getProfileSync, roundPercent } from "@/lib/server/steam-store-utils"
import {
  ensureOwnedGamesSynced,
  getRecentlyPlayedGamesForUser,
  getStoredOwnedGames,
} from "@/lib/server/steam-games-sync"
import { logger } from "@/lib/server/logger"
import {
  ACHIEVEMENTS_STALE_MS,
  ensureSchema,
  getStoredAchievements,
  persistAchievements,
} from "@/lib/server/steam-achievements-sync"

export const OWNED_GAMES_STALE_MS = 24 * 60 * 60 * 1000
const STATS_STALE_MS = 15 * 60 * 1000
const ACHIEVEMENTS_SYNC_CONCURRENCY = 5

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

// Dedupe concurrent achievement syncs for the same user. Without this,
// POST /api/steam/sync and GET /api/steam/stats fired from the same UI
// click both enter syncAchievementsForStats in parallel, doubling Steam
// API calls and error logs.
const achievementsSyncInflight = new Map<string, Promise<void>>()

async function syncAchievementsForStats(
  steamId: string,
  forceRefresh: boolean,
  options?: { skipOwnedGamesSync?: boolean },
) {
  const existing = achievementsSyncInflight.get(steamId)
  if (existing) return existing

  const promise = doSyncAchievementsForStats(steamId, forceRefresh, options)
  achievementsSyncInflight.set(steamId, promise)
  try {
    return await promise
  } finally {
    achievementsSyncInflight.delete(steamId)
  }
}

async function doSyncAchievementsForStats(
  steamId: string,
  forceRefresh: boolean,
  options?: { skipOwnedGamesSync?: boolean },
) {
  const ownedGames = options?.skipOwnedGamesSync
    ? getStoredOwnedGames(steamId)
    : await ensureOwnedGamesSynced(steamId, { forceRefresh })

  // Incremental filter: we only hit Steam for games where unlocks could
  // plausibly have changed since our last sync. The goal is to keep a full
  // refresh cheap even for 1000-game libraries.
  const stale = ownedGames.filter((game) => {
    // Skip only when Steam has *explicitly* told us the game has no community
    // stats. The flag is often missing entirely on older titles (Assassin's
    // Creed, BioShock, Call of Duty, …) — we can't use undefined/null as a
    // "no achievements" signal, so we include those games and let the first
    // GetPlayerAchievements call decide (a null response marks the game as
    // known-broken via the total_count === 0 rule below).
    if (game.has_community_visible_stats === false) return false

    const stored = getStoredAchievements(steamId, game.appid)

    // Transient failure recovery: Steam says stats exist but we recorded 0
    // (likely a 500/timeout during the first sync). Always retry these.
    if (stored?.achievements_synced_at && (stored.total_count ?? 0) === 0 && game.has_community_visible_stats === true)
      return true

    // Known-broken: synced once and reported 0 achievements, AND Steam
    // didn't flag the game as having community stats. Don't keep retrying.
    if (stored?.achievements_synced_at && (stored.total_count ?? 0) === 0) return false

    // Never synced → always include (covers first sync and new purchases).
    if (!stored?.achievements_synced_at) return true

    // Weekly safety floor: re-sync anything older than ACHIEVEMENTS_STALE_MS
    // regardless of playtime, to catch edge cases like community-event
    // unlocks that don't move rtime_last_played.
    if (isStale(stored.achievements_synced_at, ACHIEVEMENTS_STALE_MS)) return true

    // Incremental: only re-sync if the game was actually played after our
    // last successful sync. rtime_last_played is Unix seconds, synced_at is
    // an ISO timestamp.
    const syncedAtMs = Date.parse(stored.achievements_synced_at)
    const playedAtMs = (game.rtime_last_played ?? 0) * 1000
    return playedAtMs > syncedAtMs
  })

  if (stale.length === 0) return

  // Fan out per-game GetPlayerAchievements requests with bounded concurrency.
  // The bulk GetTopAchievementsForGames endpoint was tried but is unusable:
  // it identifies achievements by statid+bit and exposes only a localized
  // `name` (no apiname), so its rows cannot be joined against game_achievements.
  let cursor = 0
  async function worker() {
    while (cursor < stale.length) {
      const index = cursor++
      if (index >= stale.length) return
      const game = stale[index]
      try {
        const [playerAchievements] = await Promise.all([
          getPlayerAchievements(steamId, game.appid),
          ensureSchema(game.appid),
        ])
        persistAchievements(steamId, game.appid, playerAchievements?.achievements ?? [])
      } catch (error) {
        logger.warn({ err: error, appId: game.appid }, "Per-game achievements sync failed — will retry on next sync")
      }
    }
  }
  await Promise.all(Array.from({ length: ACHIEVEMENTS_SYNC_CONCURRENCY }, worker))
}

/**
 * Computes aggregate stats for a user (games, achievements, playtime, completion).
 * Returns a cached snapshot if fresh, otherwise syncs achievements and recomputes.
 *
 * Pass `skipOwnedGamesSync: true` when the caller has already force-synced
 * owned games earlier in the same request — avoids repeating the heavy
 * pipeline (pinned/extras/hydrate/images) three times inside a single
 * `synchronizeUserData` call.
 */
export async function getStatsForUser(
  steamId: string,
  options?: { forceRefresh?: boolean; skipOwnedGamesSync?: boolean },
) {
  const forceRefresh = options?.forceRefresh ?? false
  if (!options?.skipOwnedGamesSync) {
    await ensureOwnedGamesSynced(steamId, { forceRefresh })
  }

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

  await syncAchievementsForStats(steamId, forceRefresh, { skipOwnedGamesSync: options?.skipOwnedGamesSync })
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

/**
 * Force-refreshes all user data: owned games, recent games, and stats.
 *
 * Runs the heavy owned-games pipeline exactly once — subsequent calls
 * (`getRecentlyPlayedGamesForUser`, `getStatsForUser`) read from the
 * just-synced database without re-triggering extras sync,
 * `hydrateMissingExtraNames`, etc. Emits info-level milestones so slow
 * production syncs can be diagnosed from logs.
 */
export async function synchronizeUserData(steamId: string) {
  const startedAt = Date.now()
  logger.info({ steamId }, "Sync: start")

  const ownedGames = await ensureOwnedGamesSynced(steamId, { forceRefresh: true })
  logger.info(
    { steamId, ownedGamesCount: ownedGames.length, elapsedMs: Date.now() - startedAt },
    "Sync: owned games + extras synced",
  )

  // No forceRefresh — the call above already refreshed everything, so the
  // staleness check inside ensureOwnedGamesSynced short-circuits and this
  // just reads from the DB.
  const recentGames = await getRecentlyPlayedGamesForUser(steamId)
  logger.info({ steamId, elapsedMs: Date.now() - startedAt }, "Sync: recent games resolved")

  // skipOwnedGamesSync avoids a second pass through the owned-games pipeline.
  // forceRefresh still bypasses the stats snapshot cache so aggregates are
  // recomputed from the just-synced data.
  const stats = await getStatsForUser(steamId, { forceRefresh: true, skipOwnedGamesSync: true })
  logger.info({ steamId, elapsedMs: Date.now() - startedAt }, "Sync: stats recomputed")

  return {
    syncedAt: new Date().toISOString(),
    ownedGames: ownedGames.length,
    recentGames: recentGames.length,
    stats,
  }
}
