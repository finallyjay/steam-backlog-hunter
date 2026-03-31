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

vi.mock("@/lib/server/steam-store", () => ({
  getStoredGameForUser: vi.fn(),
}))

import { GET } from "@/app/api/steam/game/[id]/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { getStoredGameForUser } from "@/lib/server/steam-store"

const mockUser = {
  steamId: "76561198000000001",
  displayName: "test",
  avatar: "",
  profileUrl: "",
}

function makeRequest(id: string) {
  return new Request(`http://localhost/api/steam/game/${id}`)
}

describe("GET /api/steam/game/:id", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const response = await GET(makeRequest("730"), { params: Promise.resolve({ id: "730" }) })

    expect(response.status).toBe(401)
  })

  it("returns 400 for invalid app ID", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)

    const response = await GET(makeRequest("abc"), { params: Promise.resolve({ id: "abc" }) })

    expect(response.status).toBe(400)
  })

  it("returns 404 when game not found", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getStoredGameForUser).mockResolvedValue(null)

    const response = await GET(makeRequest("99999"), { params: Promise.resolve({ id: "99999" }) })

    expect(response.status).toBe(404)
  })

  it("returns game data on success", async () => {
    const mockGame = { appid: 730, name: "CS2", playtime_forever: 500 }
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(getStoredGameForUser).mockResolvedValue(mockGame as never)

    const response = await GET(makeRequest("730"), { params: Promise.resolve({ id: "730" }) })
    const body = (await response.json()) as { game: typeof mockGame }

    expect(response.status).toBe(200)
    expect(body.game).toEqual(mockGame)
  })
})
