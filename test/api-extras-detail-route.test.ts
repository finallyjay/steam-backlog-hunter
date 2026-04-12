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
  getStoredExtraGame: vi.fn(),
  getExtraAchievementsList: vi.fn(),
}))

import { GET } from "@/app/api/steam/extras/[id]/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getStoredExtraGame, getExtraAchievementsList } from "@/lib/server/extra-games"

const mockUser = { steamId: "76561198023709299", displayName: "Jay", avatar: "", profileUrl: "" }

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset()
  vi.mocked(getStoredExtraGame).mockReset()
  vi.mocked(getExtraAchievementsList).mockReset()
})

afterEach(() => vi.clearAllMocks())

function makeRequest(id: string) {
  return [new Request(`http://localhost/api/steam/extras/${id}`), { params: Promise.resolve({ id }) }] as const
}

describe("GET /api/steam/extras/:id", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const res = await GET(...makeRequest("111"))
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid appId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await GET(...makeRequest("abc"))
    expect(res.status).toBe(400)
  })

  it("returns 404 when extra not found", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getStoredExtraGame).mockReturnValue(null)
    const res = await GET(...makeRequest("111"))
    expect(res.status).toBe(404)
  })

  it("returns game + achievements on success", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getStoredExtraGame).mockReturnValue({
      appid: 111,
      name: "Test Game",
      image_landscape_url: null,
      image_portrait_url: null,
      image_icon_url: null,
      playtime_forever: 60,
      rtime_first_played: null,
      rtime_last_played: null,
      unlocked_count: 1,
      total_count: 2,
      perfect_game: 0,
      achievements_synced_at: "2026-01-01",
      synced_at: "2026-01-01",
    })
    vi.mocked(getExtraAchievementsList).mockResolvedValue([])
    const res = await GET(...makeRequest("111"))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { game: { appid: number }; achievements: unknown[] }
    expect(body.game.appid).toBe(111)
    expect(body.achievements).toEqual([])
  })

  it("returns 500 on unexpected error", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getStoredExtraGame).mockImplementation(() => {
      throw new Error("db error")
    })
    const res = await GET(...makeRequest("111"))
    expect(res.status).toBe(500)
  })
})
