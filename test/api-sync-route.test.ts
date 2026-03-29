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

vi.mock("@/lib/server/rate-limit", () => ({
  rateLimit: vi.fn(),
}))

vi.mock("@/lib/server/steam-store", () => ({
  getUserSyncStatus: vi.fn(),
  synchronizeUserData: vi.fn(),
}))

import { GET, POST } from "@/app/api/steam/sync/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { rateLimit } from "@/lib/server/rate-limit"
import { synchronizeUserData } from "@/lib/server/steam-store"

const mockUser = {
  steamId: "76561198000000001",
  displayName: "test",
  avatar: "",
  profileUrl: "",
}

describe("GET /api/steam/sync", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const response = await GET()
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })
})

describe("POST /api/steam/sync", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const response = await POST()
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })

  it("returns 429 when rate limited", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(rateLimit).mockReturnValue({ success: false, remaining: 0 })

    const response = await POST()
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(429)
    expect(body.error).toBe("Too many requests")
  })

  it("synchronizes data when authenticated and not rate limited", async () => {
    const syncResult = { synced: true }
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(rateLimit).mockReturnValue({ success: true, remaining: 4 })
    vi.mocked(synchronizeUserData).mockResolvedValue(syncResult as never)

    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(syncResult)
    expect(synchronizeUserData).toHaveBeenCalledWith(mockUser.steamId)
  })
})
