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

describe("GET /api/steam/stats", () => {
  it("returns 401 when user is not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const response = await GET(new Request("http://localhost/api/steam/stats"))
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(401)
    expect(body.error).toBe("Unauthorized")
  })
})
