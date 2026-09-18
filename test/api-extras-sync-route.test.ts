// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

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

vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: vi.fn(),
}))

vi.mock("@/lib/server/extra-games", () => ({
  getStoredExtraGame: vi.fn(),
  getExtraAchievementsList: vi.fn(),
  syncExtraGameAchievements: vi.fn(),
}))

import { POST } from "@/app/api/steam/extras/[id]/sync/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { rateLimit } from "@/lib/server/rate-limit"
import { getExtraAchievementsList, getStoredExtraGame, syncExtraGameAchievements } from "@/lib/server/extra-games"

const mockUser = {
  steamId: "76561198023709299",
  displayName: "test",
  avatar: "",
  profileUrl: "",
}

const extra = {
  appid: 111,
  name: "Extra",
  kind: "unknown" as const,
  image_landscape_url: null,
  image_portrait_url: null,
  image_icon_url: null,
  playtime_forever: 100,
  rtime_first_played: null,
  rtime_last_played: null,
  unlocked_count: 1,
  total_count: 2,
  perfect_game: 0,
  achievements_synced_at: "2026-09-18T10:00:00.000Z",
  synced_at: "2026-09-18T10:00:00.000Z",
}

function call(id: string) {
  return POST(new Request("http://localhost"), { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
  vi.mocked(rateLimit).mockReturnValue({ success: true, remaining: 9 })
  vi.mocked(getStoredExtraGame).mockReturnValue(extra)
  vi.mocked(getExtraAchievementsList).mockResolvedValue([])
  vi.mocked(syncExtraGameAchievements).mockResolvedValue(undefined)
})

describe("POST /api/steam/extras/:id/sync", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const response = await call("111")
    expect(response.status).toBe(401)
    expect(syncExtraGameAchievements).not.toHaveBeenCalled()
  })

  it("returns 400 for an invalid app id", async () => {
    const response = await call("abc")
    expect(response.status).toBe(400)
  })

  it("returns 429 when rate limited", async () => {
    vi.mocked(rateLimit).mockReturnValue({ success: false, remaining: 0 })
    const response = await call("111")
    expect(response.status).toBe(429)
    expect(rateLimit).toHaveBeenCalledWith(`extra-sync:${mockUser.steamId}`, 10, 60_000)
  })

  it("returns 404 when the app is not one of the user's extras", async () => {
    vi.mocked(getStoredExtraGame).mockReturnValue(null)
    const response = await call("111")
    expect(response.status).toBe(404)
    expect(syncExtraGameAchievements).not.toHaveBeenCalled()
  })

  it("refreshes the extra and returns the detail shape", async () => {
    const achievements = [{ apiname: "A", displayName: "A", achieved: 1 }]
    vi.mocked(getExtraAchievementsList).mockResolvedValue(achievements as never)
    const response = await call("111")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ game: extra, achievements })
    expect(syncExtraGameAchievements).toHaveBeenCalledWith(mockUser.steamId, 111)
  })

  it("returns 502 when Steam fails", async () => {
    vi.mocked(syncExtraGameAchievements).mockRejectedValue(new Error("steam down"))
    const response = await call("111")
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "Failed to refresh achievements from Steam" })
  })
})
