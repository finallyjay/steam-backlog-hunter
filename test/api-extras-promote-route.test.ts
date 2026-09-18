// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/env", () => ({
  env: new Proxy({}, { get: (_t, prop) => process.env[prop as string] }),
}))
vi.mock("@/lib/server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))
vi.mock("@/app/lib/server-auth", () => ({ getCurrentUser: vi.fn() }))
vi.mock("@/lib/server/rate-limit", () => ({ rateLimit: vi.fn() }))
vi.mock("@/lib/server/manual-ownership", () => ({ promoteExtraToLibrary: vi.fn() }))

import { POST } from "@/app/api/steam/extras/[id]/promote/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { rateLimit } from "@/lib/server/rate-limit"
import { promoteExtraToLibrary } from "@/lib/server/manual-ownership"

const mockUser = { steamId: "76561198023709299", displayName: "test", avatar: "", profileUrl: "" }
const call = (id: string) => POST(new Request("http://localhost"), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
  vi.mocked(rateLimit).mockReturnValue({ success: true, remaining: 19 })
})

describe("POST /api/steam/extras/:id/promote", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    expect((await call("111")).status).toBe(401)
    expect(promoteExtraToLibrary).not.toHaveBeenCalled()
  })

  it("returns 400 for an invalid app id", async () => {
    expect((await call("nope")).status).toBe(400)
  })

  it("returns 429 when rate limited", async () => {
    vi.mocked(rateLimit).mockReturnValue({ success: false, remaining: 0 })
    expect((await call("111")).status).toBe(429)
    expect(rateLimit).toHaveBeenCalledWith(`extra-promote:${mockUser.steamId}`, 20, 60_000)
  })

  it("returns 404 when the app is not one of the user's extras", async () => {
    vi.mocked(promoteExtraToLibrary).mockResolvedValue(null)
    expect((await call("111")).status).toBe(404)
  })

  it("promotes and returns the game", async () => {
    const game = { appid: 111, name: "Promoted", ownedSource: "manual" }
    vi.mocked(promoteExtraToLibrary).mockResolvedValue(game as never)
    const response = await call("111")
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ game })
    expect(promoteExtraToLibrary).toHaveBeenCalledWith(mockUser.steamId, 111)
  })

  it("returns 500 on failure", async () => {
    vi.mocked(promoteExtraToLibrary).mockRejectedValue(new Error("db"))
    expect((await call("111")).status).toBe(500)
  })
})
