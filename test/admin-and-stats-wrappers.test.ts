// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  delete process.env.ADMIN_STEAM_ID
})

describe("isAdmin", () => {
  it("returns false when ADMIN_STEAM_ID is not set", async () => {
    vi.doMock("@/lib/env", () => ({
      env: new Proxy(
        {},
        {
          get(_t, prop) {
            return process.env[prop as string]
          },
        },
      ),
    }))
    delete process.env.ADMIN_STEAM_ID
    const { isAdmin } = await import("@/lib/server/admin")
    expect(isAdmin("76561198000000001")).toBe(false)
  })

  it("returns true only when the id matches exactly", async () => {
    vi.doMock("@/lib/env", () => ({
      env: new Proxy(
        {},
        {
          get(_t, prop) {
            return process.env[prop as string]
          },
        },
      ),
    }))
    process.env.ADMIN_STEAM_ID = "76561198000000001"
    const { isAdmin } = await import("@/lib/server/admin")
    expect(isAdmin("76561198000000001")).toBe(true)
    expect(isAdmin("76561198000000002")).toBe(false)
  })
})

describe("getUserStats (lib/steam-stats.ts wrapper)", () => {
  it("passes through a successful response from getStatsForUser", async () => {
    vi.doMock("@/lib/server/steam-store", () => ({
      getStatsForUser: vi.fn().mockResolvedValue({
        totalGames: 10,
        gamesWithAchievements: 5,
        totalAchievements: 20,
        pendingAchievements: 15,
        startedGames: 3,
        averageCompletion: 42,
        totalPlaytime: 100,
        perfectGames: 1,
      }),
    }))
    vi.doMock("@/lib/server/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))
    const { getUserStats } = await import("@/lib/steam-stats")
    const stats = await getUserStats("76561198000000001")
    expect(stats.totalGames).toBe(10)
    expect(stats.averageCompletion).toBe(42)
  })

  it("returns zeroed defaults when getStatsForUser throws", async () => {
    vi.doMock("@/lib/server/steam-store", () => ({
      getStatsForUser: vi.fn().mockRejectedValue(new Error("boom")),
    }))
    const errorSpy = vi.fn()
    vi.doMock("@/lib/server/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: errorSpy, debug: vi.fn() },
    }))
    const { getUserStats } = await import("@/lib/steam-stats")
    const stats = await getUserStats("76561198000000001")
    expect(stats).toEqual({
      totalGames: 0,
      gamesWithAchievements: 0,
      totalAchievements: 0,
      pendingAchievements: 0,
      startedGames: 0,
      averageCompletion: 0,
      totalPlaytime: 0,
      perfectGames: 0,
    })
    expect(errorSpy).toHaveBeenCalled()
  })

  it("forwards the forceRefresh option", async () => {
    const getStatsSpy = vi.fn().mockResolvedValue({
      totalGames: 0,
      gamesWithAchievements: 0,
      totalAchievements: 0,
      pendingAchievements: 0,
      startedGames: 0,
      averageCompletion: 0,
      totalPlaytime: 0,
      perfectGames: 0,
    })
    vi.doMock("@/lib/server/steam-store", () => ({ getStatsForUser: getStatsSpy }))
    vi.doMock("@/lib/server/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }))
    const { getUserStats } = await import("@/lib/steam-stats")
    await getUserStats("76561198000000001", { forceRefresh: true })
    expect(getStatsSpy).toHaveBeenCalledWith("76561198000000001", { forceRefresh: true })
  })
})
