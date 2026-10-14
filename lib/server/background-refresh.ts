import "server-only"

import { logger } from "@/lib/server/logger"
import { invalidateStatsCache } from "@/lib/server/stats-cache"
import { ensureOwnedGamesSynced } from "@/lib/server/steam-games-sync"
import {
  OWNED_GAMES_STALE_MS,
  STATS_STALE_MS,
  getStatsForUser,
  getStoredStatsSnapshot,
} from "@/lib/server/steam-stats-compute"
import { getProfileSync, isStale } from "@/lib/server/steam-store-utils"

// Minimum gap between two background refreshes for the same user. A refresh
// can finish with the data still stale (Steam down, GetOwnedGames returning
// empty and the existing library being preserved), and the client polls the
// sync status while one is running: without this, every poll would start a
// new refresh against a failing upstream.
export const BACKGROUND_REFRESH_COOLDOWN_MS = 5 * 60 * 1000

const inflight = new Map<string, Promise<void>>()
const lastStartedAt = new Map<string, number>()

/** True when the stored owned games or the stats snapshot are past their staleness window. */
export function isUserDataStale(steamId: string): boolean {
  const ownedSyncedAt = getProfileSync(steamId)?.last_owned_games_sync_at
  const snapshot = getStoredStatsSnapshot(steamId)
  return isStale(ownedSyncedAt, OWNED_GAMES_STALE_MS) || isStale(snapshot?.computed_at, STATS_STALE_MS)
}

/** True while a background refresh is running for the user. */
export function isBackgroundRefreshRunning(steamId: string): boolean {
  return inflight.has(steamId)
}

/**
 * Stale-while-revalidate companion for the read endpoints: when the user's
 * stored data is stale, starts a refresh (owned games pipeline, incremental
 * achievements sync, stats snapshot recompute) without awaiting it, so the
 * request can answer from SQLite immediately. Deduplicated per user and
 * rate-limited by `BACKGROUND_REFRESH_COOLDOWN_MS`; the heavy steps also
 * share the in-flight dedupe of a manual `POST /api/steam/sync`.
 *
 * Returns whether a background refresh is running after the call.
 */
export function refreshUserDataInBackgroundIfStale(steamId: string): boolean {
  if (inflight.has(steamId)) return true
  const startedAt = lastStartedAt.get(steamId)
  if (startedAt !== undefined && Date.now() - startedAt < BACKGROUND_REFRESH_COOLDOWN_MS) return false
  if (!isUserDataStale(steamId)) return false

  lastStartedAt.set(steamId, Date.now())
  const job = (async () => {
    const started = Date.now()
    logger.info({ steamId }, "Background refresh: start")
    try {
      await ensureOwnedGamesSynced(steamId)
      // forceRefresh recomputes the snapshot from the just-synced rows;
      // skipOwnedGamesSync avoids a second pass through the pipeline above.
      await getStatsForUser(steamId, { forceRefresh: true, skipOwnedGamesSync: true })
      invalidateStatsCache(steamId)
      logger.info({ steamId, elapsedMs: Date.now() - started }, "Background refresh: done")
    } catch (error) {
      logger.error({ err: error, steamId, elapsedMs: Date.now() - started }, "Background refresh failed")
    } finally {
      inflight.delete(steamId)
    }
  })()
  inflight.set(steamId, job)
  return true
}
