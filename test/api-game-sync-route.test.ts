// @vitest-environment node
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

vi.mock("@/lib/server/steam-games-sync", () => ({
  getStoredGameForUser: vi.fn(),
}))

vi.mock("@/lib/server/steam-achievements-sync", () => ({
  getAchievementsForGame: vi.fn(),
}))

vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: vi.fn().mockReturnValue({ success: true, remaining: 9 }),
}))

import { POST } from "@/app/api/steam/game/[id]/sync/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getStoredGameForUser } from "@/lib/server/steam-games-sync"
import { getAchievementsForGame } from "@/lib/server/steam-achievements-sync"
import { rateLimit } from "@/lib/server/rate-limit"

const mockUser = {
  steamId: "76561198023709299",
  displayName: "test",
  avatar: "",
  profileUrl: "",
}

function makeRequest(id: string) {
  return new Request(`http://localhost/api/steam/game/${id}/sync`, { method: "POST" })
}

describe("POST /api/steam/game/:id/sync", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const response = await POST(makeRequest("730"), { params: Promise.resolve({ id: "730" }) })
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  it("returns 400 for invalid app ID", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)

    const response = await POST(makeRequest("abc"), { params: Promise.resolve({ id: "abc" }) })
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(body.error).toBe("Valid App ID required")
  })

  it("returns 400 for negative app ID", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)

    const response = await POST(makeRequest("-1"), { params: Promise.resolve({ id: "-1" }) })

    expect(response.status).toBe(400)
  })

  it("returns 429 when rate limited", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(rateLimit).mockReturnValueOnce({ success: false, remaining: 0 })

    const response = await POST(makeRequest("730"), { params: Promise.resolve({ id: "730" }) })
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(429)
    expect(body.error).toBe("Too many requests")
  })

  it("returns 404 when game is not found", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getStoredGameForUser).mockResolvedValue(null)

    const response = await POST(makeRequest("99999"), { params: Promise.resolve({ id: "99999" }) })
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(404)
    expect(body.error).toBe("Game not found")
  })

  it("returns updated achievements on successful sync", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getStoredGameForUser).mockResolvedValue({ appid: 730, name: "CS2" } as never)
    vi.mocked(getAchievementsForGame).mockResolvedValue({
      steamID: mockUser.steamId,
      gameName: "CS2",
      achievements: [
        {
          apiname: "ach_1",
          achieved: 1,
          unlocktime: 100,
          displayName: "First",
          description: "",
          icon: "",
          icongray: "",
        },
      ],
      success: true,
    })

    const response = await POST(makeRequest("730"), { params: Promise.resolve({ id: "730" }) })
    const body = (await response.json()) as { achievements: unknown[]; gameName: string }

    expect(response.status).toBe(200)
    expect(body.gameName).toBe("CS2")
    expect(body.achievements).toHaveLength(1)
    expect(getAchievementsForGame).toHaveBeenCalledWith(mockUser.steamId, 730, { forceRefresh: true })
  })

  it("returns empty achievements when game has none", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getStoredGameForUser).mockResolvedValue({ appid: 440, name: "TF2" } as never)
    vi.mocked(getAchievementsForGame).mockResolvedValue(null)

    const response = await POST(makeRequest("440"), { params: Promise.resolve({ id: "440" }) })
    const body = (await response.json()) as { achievements: unknown[]; gameName: string }

    expect(response.status).toBe(200)
    expect(body.achievements).toEqual([])
    expect(body.gameName).toBe("TF2")
  })
})
