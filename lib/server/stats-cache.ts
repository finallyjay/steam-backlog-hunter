import "server-only"

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
//
// Lives in its own module so the background refresh can invalidate it
// without importing `lib/steam-stats.ts` (which would be a cycle).
const STATS_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour
type CacheEntry = { stats: SteamStatsResponse; expiresAt: number }
const statsCache = new Map<string, CacheEntry>()

/** Returns the cached stats for a user, or null when absent or expired. */
export function getCachedStats(steamId: string): SteamStatsResponse | null {
  const cached = statsCache.get(steamId)
  return cached && cached.expiresAt > Date.now() ? cached.stats : null
}

/** Stores stats for a user for the cache TTL. */
export function setCachedStats(steamId: string, stats: SteamStatsResponse): void {
  statsCache.set(steamId, { stats, expiresAt: Date.now() + STATS_CACHE_TTL_MS })
}

/** Drops the cached stats entry for a user. Called after a manual or background sync. */
export function invalidateStatsCache(steamId: string): void {
  statsCache.delete(steamId)
}
