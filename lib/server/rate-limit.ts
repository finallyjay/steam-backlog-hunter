import "server-only"

interface RateLimitEntry {
  timestamps: number[]
}

const store = new Map<string, RateLimitEntry>()

// Clean up expired entries every 60 seconds
const CLEANUP_INTERVAL_MS = 60_000

let lastCleanup = Date.now()

function cleanup(now: number) {
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now

  for (const [key, entry] of store) {
    // Remove entries where all timestamps are older than any reasonable window (5 minutes)
    const cutoff = now - 5 * 60_000
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff)
    if (entry.timestamps.length === 0) {
      store.delete(key)
    }
  }
}

/**
 * Sliding-window in-memory rate limiter.
 *
 * @param key - Identifier for the rate limit bucket (e.g. IP or user ID)
 * @param limit - Maximum number of requests allowed in the window
 * @param windowMs - Window duration in milliseconds
 * @returns Whether the request is allowed and how many requests remain
 */
export function rateLimit(key: string, limit: number, windowMs: number): { success: boolean; remaining: number } {
  const now = Date.now()
  cleanup(now)

  const entry = store.get(key) ?? { timestamps: [] }
  const windowStart = now - windowMs

  // Keep only timestamps within the current window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart)

  if (entry.timestamps.length >= limit) {
    store.set(key, entry)
    return { success: false, remaining: 0 }
  }

  entry.timestamps.push(now)
  store.set(key, entry)

  return { success: true, remaining: limit - entry.timestamps.length }
}
