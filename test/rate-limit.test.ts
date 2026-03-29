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
})
