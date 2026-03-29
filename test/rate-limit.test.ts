// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import { rateLimit } from "@/lib/server/rate-limit"

describe("rateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("allows requests within the limit", () => {
    const key = "test-allow"
    const limit = 3
    const windowMs = 60_000

    const r1 = rateLimit(key, limit, windowMs)
    expect(r1.success).toBe(true)
    expect(r1.remaining).toBe(2)

    const r2 = rateLimit(key, limit, windowMs)
    expect(r2.success).toBe(true)
    expect(r2.remaining).toBe(1)

    const r3 = rateLimit(key, limit, windowMs)
    expect(r3.success).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it("rejects requests exceeding the limit", () => {
    const key = "test-exceed"
    const limit = 2
    const windowMs = 60_000

    rateLimit(key, limit, windowMs)
    rateLimit(key, limit, windowMs)

    const result = rateLimit(key, limit, windowMs)
    expect(result.success).toBe(false)
    expect(result.remaining).toBe(0)
  })

  it("resets after the time window passes", () => {
    const key = "test-reset"
    const limit = 1
    const windowMs = 10_000

    const r1 = rateLimit(key, limit, windowMs)
    expect(r1.success).toBe(true)

    const r2 = rateLimit(key, limit, windowMs)
    expect(r2.success).toBe(false)

    // Advance time past the window
    vi.advanceTimersByTime(windowMs + 1)

    const r3 = rateLimit(key, limit, windowMs)
    expect(r3.success).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it("cleans up expired entries after cleanup interval", () => {
    const key = "test-cleanup"
    const limit = 5
    const windowMs = 60_000

    // Create an entry
    rateLimit(key, limit, windowMs)

    // Advance past the max window (10 minutes) AND past the cleanup interval (60s)
    vi.advanceTimersByTime(10 * 60_000 + 1)

    // Trigger cleanup by making another request with a different key
    const freshKey = "test-cleanup-fresh"
    const result = rateLimit(freshKey, limit, windowMs)
    expect(result.success).toBe(true)
    expect(result.remaining).toBe(4)

    // The old key should have been cleaned up, so it should behave like a fresh key
    const oldResult = rateLimit(key, limit, windowMs)
    expect(oldResult.success).toBe(true)
    expect(oldResult.remaining).toBe(4)
  })

  it("evicts oldest entries when store exceeds MAX_STORE_SIZE", () => {
    const limit = 5
    const windowMs = 60_000

    // Fill the store beyond MAX_STORE_SIZE (10,000)
    for (let i = 0; i < 10_001; i++) {
      rateLimit(`evict-key-${i}`, limit, windowMs)
    }

    // Adding a new key should still work (eviction makes room)
    const result = rateLimit("evict-new-key", limit, windowMs)
    expect(result.success).toBe(true)
  })

  it("different keys don't interfere with each other", () => {
    const limit = 1
    const windowMs = 60_000

    const r1 = rateLimit("key-a", limit, windowMs)
    expect(r1.success).toBe(true)

    // key-a is now exhausted
    const r2 = rateLimit("key-a", limit, windowMs)
    expect(r2.success).toBe(false)

    // key-b should still be allowed
    const r3 = rateLimit("key-b", limit, windowMs)
    expect(r3.success).toBe(true)
    expect(r3.remaining).toBe(0)
  })
})
