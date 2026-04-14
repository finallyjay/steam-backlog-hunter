import "server-only"

import { getStatsForUser } from "@/lib/server/steam-store"
import { logger } from "@/lib/server/logger"
import type { SteamStatsResponse } from "@/lib/types/steam"

// In-memory stats cache. Shared across requests within the same Node process.
// Doesn't survive a process restart and doesn't sync across multi-instance
// deployments — both acceptable for this single-user whitelist app.
//
// We tried the Next 16 Cache Components approach (`'use cache'` directive +
// `cacheTag` + `updateTag`) but enabling `cacheComponents: true` requires
// every cookie-reading API route to be marked `force-dynamic` and every
// client component that consumes a hook like `useCurrentUser()` to be
// wrapped in a `<Suspense>` boundary. That's a multi-PR migration. This
// module-level Map gives the same observable behavior for /api/steam/stats
// (cached for ~1h, invalidated on sync) without the framework migration.
const STATS_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
type CacheEntry = { stats: SteamStatsResponse; expiresAt: number }
const statsCache = new Map<string, CacheEntry>()

/** Drops the cached stats entry for a user. Called from the sync route after a successful sync. */
export function invalidateStatsCache(steamId: string): void {
  statsCache.delete(steamId)
}

/**
 * Fetches aggregate user stats, returning zeroed defaults on failure. When
 * forceRefresh is set, bypasses the in-memory cache and goes straight to
 * getStatsForUser (which itself recomputes from the database). Otherwise
 * serves from the in-memory cache when fresh.
 */
export async function getUserStats(steamId: string, options?: { forceRefresh?: boolean }): Promise<SteamStatsResponse> {
  try {
    if (!options?.forceRefresh) {
      const cached = statsCache.get(steamId)
      if (cached && cached.expiresAt > Date.now()) {
        return cached.stats
      }
    }
    const stats = await getStatsForUser(steamId, options)
    statsCache.set(steamId, { stats, expiresAt: Date.now() + STATS_CACHE_TTL_MS })
    return stats
  } catch (error) {
    logger.error({ err: error }, "Error fetching user stats")
    return {
      totalGames: 0,
      gamesWithAchievements: 0,
      totalAchievements: 0,
      pendingAchievements: 0,
      startedGames: 0,
      averageCompletion: 0,
      totalPlaytime: 0,
      perfectGames: 0,
    }
  }
}
