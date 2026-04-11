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

vi.mock("@/lib/server/steam-store", () => ({
  getAchievementsForGame: vi.fn(),
  getBatchStoredAchievements: vi.fn(),
}))

import { GET as singleGet } from "@/app/api/steam/achievements/route"
import { GET as batchGet } from "@/app/api/steam/achievements/batch/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getAchievementsForGame, getBatchStoredAchievements } from "@/lib/server/steam-store"

const mockUser = {
  steamId: "76561198000000001",
  displayName: "Tester",
  avatar: "",
  profileUrl: "",
}

function makeRequest(url: string) {
  return new Request(url) as unknown as Parameters<typeof singleGet>[0]
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset()
  vi.mocked(getAchievementsForGame).mockReset()
  vi.mocked(getBatchStoredAchievements).mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/steam/achievements", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const res = await singleGet(makeRequest("http://localhost/api/steam/achievements?appId=620"))
    expect(res.status).toBe(401)
  })

  it("returns 400 when appId is missing", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await singleGet(makeRequest("http://localhost/api/steam/achievements"))
    expect(res.status).toBe(400)
  })

  it("returns 400 when appId is not a positive number", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await singleGet(makeRequest("http://localhost/api/steam/achievements?appId=abc"))
    expect(res.status).toBe(400)
  })

  it("returns 404 when the game has no achievements / is not owned", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getAchievementsForGame).mockResolvedValue(null)
    const res = await singleGet(makeRequest("http://localhost/api/steam/achievements?appId=620"))
    expect(res.status).toBe(404)
  })

  it("returns 200 with the achievements payload on success", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getAchievementsForGame).mockResolvedValue({
      steamID: "76561198000000001",
      gameName: "Portal 2",
      achievements: [],
      success: true,
    })
    const res = await singleGet(makeRequest("http://localhost/api/steam/achievements?appId=620"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.gameName).toBe("Portal 2")
  })

  it("forwards ?refresh=1 as forceRefresh=true", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getAchievementsForGame).mockResolvedValue({
      steamID: "76561198000000001",
      gameName: "Portal 2",
      achievements: [],
      success: true,
    })
    await singleGet(makeRequest("http://localhost/api/steam/achievements?appId=620&refresh=1"))
    expect(getAchievementsForGame).toHaveBeenCalledWith(mockUser.steamId, 620, { forceRefresh: true })
  })

  it("forwards ?force=1 as forceRefresh=true (alias)", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getAchievementsForGame).mockResolvedValue({
      steamID: "76561198000000001",
      gameName: "Portal 2",
      achievements: [],
      success: true,
    })
    await singleGet(makeRequest("http://localhost/api/steam/achievements?appId=620&force=1"))
    expect(getAchievementsForGame).toHaveBeenCalledWith(mockUser.steamId, 620, { forceRefresh: true })
  })

  it("returns 500 if getAchievementsForGame throws", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getAchievementsForGame).mockRejectedValue(new Error("boom"))
    const res = await singleGet(makeRequest("http://localhost/api/steam/achievements?appId=620"))
    expect(res.status).toBe(500)
  })
})

describe("GET /api/steam/achievements/batch", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const res = await batchGet(makeRequest("http://localhost/api/steam/achievements/batch?appIds=1,2"))
    expect(res.status).toBe(401)
  })

  it("returns 400 when appIds query parameter is missing", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await batchGet(makeRequest("http://localhost/api/steam/achievements/batch"))
    expect(res.status).toBe(400)
  })

  it("returns 400 when every appId is invalid", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await batchGet(makeRequest("http://localhost/api/steam/achievements/batch?appIds=abc,-1,0"))
    expect(res.status).toBe(400)
  })

  it("returns the achievementsMap for valid app IDs", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getBatchStoredAchievements).mockReturnValue({
      620: [],
      440: [],
    })
    const res = await batchGet(makeRequest("http://localhost/api/steam/achievements/batch?appIds=620,440"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(new Set(Object.keys(body.achievementsMap))).toEqual(new Set(["620", "440"]))
  })

  it("silently filters invalid ids out of a mixed list", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getBatchStoredAchievements).mockReturnValue({ 620: [] })
    const res = await batchGet(makeRequest("http://localhost/api/steam/achievements/batch?appIds=620,abc,-5"))
    expect(res.status).toBe(200)
    expect(getBatchStoredAchievements).toHaveBeenCalledWith(mockUser.steamId, [620])
  })

  it("caps the batch at 200 app IDs", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getBatchStoredAchievements).mockReturnValue({})
    const ids = Array.from({ length: 250 }, (_, i) => String(i + 1)).join(",")
    await batchGet(makeRequest(`http://localhost/api/steam/achievements/batch?appIds=${ids}`))
    const calledWith = vi.mocked(getBatchStoredAchievements).mock.calls[0]?.[1] as number[]
    expect(calledWith.length).toBe(200)
  })

  it("returns 500 if getBatchStoredAchievements throws", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getBatchStoredAchievements).mockImplementation(() => {
      throw new Error("boom")
    })
    const res = await batchGet(makeRequest("http://localhost/api/steam/achievements/batch?appIds=620"))
    expect(res.status).toBe(500)
  })
})
