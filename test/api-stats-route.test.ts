// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/lib/server-auth", () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock("@/lib/steam-stats", () => ({
  getUserStats: vi.fn(),
}))

import { GET } from "@/app/api/steam/stats/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getUserStats } from "@/lib/steam-stats"

describe("GET /api/steam/stats", () => {
  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const response = await GET(new Request("http://localhost/api/steam/stats"))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  it("forwards force refresh option when refresh query is present", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      steamId: "76561198000000001",
      displayName: "test",
      avatar: "",
      profileUrl: "",
    })
    vi.mocked(getUserStats).mockResolvedValue({
      totalGames: 1,
      gamesWithAchievements: 1,
      totalAchievements: 2,
      pendingAchievements: 3,
      startedGames: 1,
      averageCompletion: 62.5,
      totalPlaytime: 3.5,
      perfectGames: 0,
    })

    const response = await GET(new Request("http://localhost/api/steam/stats?refresh=1"))

    expect(response.status).toBe(200)
    expect(getUserStats).toHaveBeenCalledWith("76561198000000001", { forceRefresh: true })
  })

  it("returns stats data in response body", async () => {
    const expectedStats = {
      totalGames: 5,
      gamesWithAchievements: 3,
      totalAchievements: 42,
      pendingAchievements: 10,
      startedGames: 3,
      averageCompletion: 76.2,
      totalPlaytime: 120.5,
      perfectGames: 2,
    }

    vi.mocked(getCurrentUser).mockResolvedValue({
      steamId: "76561198000000001",
      displayName: "test",
      avatar: "",
      profileUrl: "",
    })
    vi.mocked(getUserStats).mockResolvedValue(expectedStats)

    const response = await GET(new Request("http://localhost/api/steam/stats"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(expectedStats)
  })
})
