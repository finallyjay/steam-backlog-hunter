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
  setExtraKind: vi.fn(),
}))

import { GET, PATCH } from "@/app/api/steam/extras/[id]/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getStoredExtraGame, getExtraAchievementsList, setExtraKind } from "@/lib/server/extra-games"

const mockUser = { steamId: "76561198023709299", displayName: "Jay", avatar: "", profileUrl: "" }

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset()
  vi.mocked(getStoredExtraGame).mockReset()
  vi.mocked(getExtraAchievementsList).mockReset()
  vi.mocked(setExtraKind).mockReset()
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
      kind: "unknown",
      kind_source: null,
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

describe("PATCH /api/steam/extras/:id", () => {
  function patch(id: string, body: unknown) {
    const request = new Request(`http://localhost/api/steam/extras/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
    return PATCH(request, { params: Promise.resolve({ id }) })
  }

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const response = await patch("111", { kind: "demo" })
    expect(response.status).toBe(401)
  })

  it("returns 400 for an invalid app id, malformed JSON, missing or unknown kind", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    expect((await patch("abc", { kind: "demo" })).status).toBe(400)
    expect((await patch("111", "{not json")).status).toBe(400)
    expect((await patch("111", {})).status).toBe(400)
    expect((await patch("111", { kind: "spaceship" })).status).toBe(400)
    expect(setExtraKind).not.toHaveBeenCalled()
  })

  it("returns 404 when the app is not one of the user's extras", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(setExtraKind).mockReturnValue(null)
    const response = await patch("111", { kind: "demo" })
    expect(response.status).toBe(404)
  })

  it("sets the override and returns the refreshed extra", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const game = { appid: 111, name: "X", kind: "demo", kind_source: "manual" }
    vi.mocked(setExtraKind).mockReturnValue(game as never)
    const response = await patch("111", { kind: "demo" })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ game })
    expect(setExtraKind).toHaveBeenCalledWith(mockUser.steamId, 111, "demo")
  })

  it("clears the override with kind: null", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(setExtraKind).mockReturnValue({ appid: 111, kind: "unknown", kind_source: null } as never)
    const response = await patch("111", { kind: null })
    expect(response.status).toBe(200)
    expect(setExtraKind).toHaveBeenCalledWith(mockUser.steamId, 111, null)
  })
})
