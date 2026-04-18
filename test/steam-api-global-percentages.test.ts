// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Keep env access happy without forcing a real .env in tests.
vi.mock("@/lib/env", () => ({
  env: new Proxy(
    {},
    {
      get(_target, prop) {
        return process.env[prop as string]
      },
    },
  ),
}))

beforeEach(() => {
  vi.resetModules()
  process.env.STEAM_API_KEY = "test-key"
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("getGlobalAchievementPercentages", () => {
  it("coerces Steam's string percent values into numbers", async () => {
    // Steam's live API serves percent as a string ("82.3"), which the original
    // typeguard treated as an invalid entry and silently dropped — leaving
    // game_achievements.global_percent permanently null. Regression guard.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          achievementpercentages: {
            achievements: [
              { name: "ACH00", percent: "82.3" },
              { name: "ACH01", percent: "39.2" },
              { name: "ACH_NOPE", percent: "not-a-number" },
              { name: "ACH_NUMERIC", percent: 12.5 },
            ],
          },
        }),
      } as unknown as Response),
    )

    const { getGlobalAchievementPercentages } = await import("@/lib/steam-api")
    const result = await getGlobalAchievementPercentages(271590)

    expect(result).toEqual([
      { name: "ACH00", percent: 82.3 },
      { name: "ACH01", percent: 39.2 },
      { name: "ACH_NUMERIC", percent: 12.5 },
    ])
  })

  it("returns null when the response shape is unexpected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ achievementpercentages: {} }),
      } as unknown as Response),
    )

    const { getGlobalAchievementPercentages } = await import("@/lib/steam-api")
    expect(await getGlobalAchievementPercentages(271590)).toBeNull()
  })
})
