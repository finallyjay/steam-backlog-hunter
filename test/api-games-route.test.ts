// @vitest-environment node
import { NextRequest } from "next/server"
import { describe, expect, it, vi } from "vitest"

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

vi.mock("@/lib/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("@/app/lib/server-auth", () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock("@/lib/server/steam-store", () => ({
  getOwnedGamesForUser: vi.fn(),
  getRecentlyPlayedGamesForUser: vi.fn(),
}))

import { GET } from "@/app/api/steam/games/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getOwnedGamesForUser, getRecentlyPlayedGamesForUser } from "@/lib/server/steam-store"

const mockUser = {
  steamId: "76561198000000001",
  displayName: "test",
  avatar: "",
  profileUrl: "",
}

describe("GET /api/steam/games", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const request = new NextRequest("http://localhost/api/steam/games")
    const response = await GET(request)
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  it("returns recent games by default", async () => {
    const mockGames = [{ appid: 440, name: "Team Fortress 2" }]
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getRecentlyPlayedGamesForUser).mockResolvedValue(mockGames as never)

    const request = new NextRequest("http://localhost/api/steam/games")
    const response = await GET(request)
    const body = (await response.json()) as { games: unknown[] }

    expect(response.status).toBe(200)
    expect(body.games).toEqual(mockGames)
    expect(getRecentlyPlayedGamesForUser).toHaveBeenCalledWith(mockUser.steamId, { forceRefresh: false })
  })

  it("returns all games when type=all", async () => {
    const mockGames = [
      { appid: 440, name: "Team Fortress 2" },
      { appid: 730, name: "Counter-Strike 2" },
    ]
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getOwnedGamesForUser).mockResolvedValue(mockGames as never)

    const request = new NextRequest("http://localhost/api/steam/games?type=all")
    const response = await GET(request)
    const body = (await response.json()) as { games: unknown[] }

    expect(response.status).toBe(200)
    expect(body.games).toEqual(mockGames)
    expect(getOwnedGamesForUser).toHaveBeenCalledWith(mockUser.steamId, { forceRefresh: false })
  })

  it("passes force refresh when refresh=1", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getRecentlyPlayedGamesForUser).mockResolvedValue([] as never)

    const request = new NextRequest("http://localhost/api/steam/games?refresh=1")
    const response = await GET(request)

    expect(response.status).toBe(200)
    expect(getRecentlyPlayedGamesForUser).toHaveBeenCalledWith(mockUser.steamId, { forceRefresh: true })
  })

  it("returns 500 when the underlying store call throws", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getRecentlyPlayedGamesForUser).mockRejectedValue(new Error("db down"))
    const request = new NextRequest("http://localhost/api/steam/games")
    const response = await GET(request)
    expect(response.status).toBe(500)
  })
})
