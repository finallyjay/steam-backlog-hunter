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
  discoverExtraGames: vi.fn(),
  getExtrasDiscoveryStatus: vi.fn(),
}))

import { GET, POST } from "@/app/api/steam/extras/discover/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { rateLimit } from "@/lib/server/rate-limit"
import { discoverExtraGames, getExtrasDiscoveryStatus } from "@/lib/server/extra-games"

const mockUser = {
  steamId: "76561198023709299",
  displayName: "test",
  avatar: "",
  profileUrl: "",
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GET /api/steam/extras/discover", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
  })

  it("returns the discovery status", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getExtrasDiscoveryStatus).mockReturnValue({ running: false, lastDiscoveryAt: "2026-09-18T10:00:00.000Z" })
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ running: false, lastDiscoveryAt: "2026-09-18T10:00:00.000Z" })
    expect(getExtrasDiscoveryStatus).toHaveBeenCalledWith(mockUser.steamId)
  })

  it("returns 500 when the status lookup throws", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getExtrasDiscoveryStatus).mockImplementation(() => {
      throw new Error("db")
    })
    const response = await GET()
    expect(response.status).toBe(500)
  })
})

describe("POST /api/steam/extras/discover", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const response = await POST()
    expect(response.status).toBe(401)
    expect(discoverExtraGames).not.toHaveBeenCalled()
  })

  it("returns 429 when rate limited", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(rateLimit).mockReturnValue({ success: false, remaining: 0 })
    const response = await POST()
    expect(response.status).toBe(429)
    expect(rateLimit).toHaveBeenCalledWith(`extras-discover:${mockUser.steamId}`, 2, 600_000)
    expect(discoverExtraGames).not.toHaveBeenCalled()
  })

  it("runs the discovery and returns its result", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(rateLimit).mockReturnValue({ success: true, remaining: 1 })
    const result = { discoveredAt: "2026-09-18T10:00:00.000Z", added: 3, updated: 5, total: 8 }
    vi.mocked(discoverExtraGames).mockResolvedValue(result)
    const response = await POST()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(discoverExtraGames).toHaveBeenCalledWith(mockUser.steamId)
  })

  it("returns 500 when the discovery fails", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(rateLimit).mockReturnValue({ success: true, remaining: 1 })
    vi.mocked(discoverExtraGames).mockRejectedValue(new Error("steam down"))
    const response = await POST()
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: "Failed to discover extras" })
  })
})
