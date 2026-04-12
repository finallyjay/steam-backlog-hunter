// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

vi.mock("@/lib/server/extra-games", () => ({
  getExtraGamesForUser: vi.fn(),
  getHiddenGamesForUser: vi.fn(),
}))

import { NextRequest } from "next/server"
import { GET } from "@/app/api/steam/extras/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getExtraGamesForUser } from "@/lib/server/extra-games"

function makeRequest(query = "") {
  return new NextRequest(`http://localhost/api/steam/extras${query}`)
}

const mockUser = {
  steamId: "76561198023709299",
  displayName: "Jay",
  avatar: "",
  profileUrl: "",
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset()
  vi.mocked(getExtraGamesForUser).mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/steam/extras", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it("returns the extras list for the authenticated user", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getExtraGamesForUser).mockReturnValue([
      {
        appid: 111,
        name: "Refunded Game",
        image_landscape_url: null,
        image_portrait_url: null,
        image_icon_url: null,
        playtime_forever: 120,
        rtime_first_played: 1_000_000_000,
        rtime_last_played: 1_100_000_000,
        unlocked_count: 3,
        total_count: 10,
        perfect_game: 0,
        achievements_synced_at: "2026-04-11T10:00:00.000Z",
        synced_at: "2026-04-11T10:00:00.000Z",
      },
    ])
    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { games: Array<{ appid: number }> }
    expect(body.games).toHaveLength(1)
    expect(body.games[0].appid).toBe(111)
    expect(getExtraGamesForUser).toHaveBeenCalledWith("76561198023709299")
  })

  it("returns 500 when the store lookup throws", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getExtraGamesForUser).mockImplementation(() => {
      throw new Error("db closed")
    })
    const res = await GET(makeRequest())
    expect(res.status).toBe(500)
  })
})
