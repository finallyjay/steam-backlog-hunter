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

vi.mock("@/app/lib/require-admin", () => ({
  requireAdmin: vi.fn(),
}))

vi.mock("@/lib/server/pinned-games", () => ({
  listPinnedGames: vi.fn(),
  addPinnedGame: vi.fn(),
  removePinnedGame: vi.fn(),
}))

import { GET, POST, DELETE } from "@/app/api/admin/pinned-games/route"
import { requireAdmin } from "@/app/lib/require-admin"
import { listPinnedGames, addPinnedGame, removePinnedGame } from "@/lib/server/pinned-games"

const mockAdmin = {
  steamId: "76561198000000001",
  displayName: "admin",
  avatar: "",
  profileUrl: "",
}

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/admin/pinned-games", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

describe("GET /api/admin/pinned-games", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it("returns the pinned list for an admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    vi.mocked(listPinnedGames).mockReturnValue([{ appid: 274920, reason: "FaceRig", added_at: "2026-04-11" }])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pinned).toHaveLength(1)
    expect(body.pinned[0].appid).toBe(274920)
  })

  it("returns 500 if listPinnedGames throws", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    vi.mocked(listPinnedGames).mockImplementation(() => {
      throw new Error("db closed")
    })
    const res = await GET()
    expect(res.status).toBe(500)
  })
})

describe("POST /api/admin/pinned-games", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await POST(jsonRequest("POST", { appid: 274920 }))
    expect(res.status).toBe(403)
  })

  it("returns 400 on invalid JSON body", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await POST(jsonRequest("POST", "{not json"))
    expect(res.status).toBe(400)
  })

  it("returns 400 when appid is missing", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await POST(jsonRequest("POST", { reason: "x" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when appid is not a positive integer", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await POST(jsonRequest("POST", { appid: -5 }))
    expect(res.status).toBe(400)
  })

  it("calls addPinnedGame and returns success for valid input", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    vi.mocked(addPinnedGame).mockClear()
    const res = await POST(jsonRequest("POST", { appid: 274920, reason: "FaceRig" }))
    expect(res.status).toBe(200)
    expect(addPinnedGame).toHaveBeenCalledWith(274920, "FaceRig")
  })

  it("accepts a missing reason and stores null", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    vi.mocked(addPinnedGame).mockClear()
    const res = await POST(jsonRequest("POST", { appid: 432150 }))
    expect(res.status).toBe(200)
    expect(addPinnedGame).toHaveBeenCalledWith(432150, null)
  })

  it("returns 500 if addPinnedGame throws", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    vi.mocked(addPinnedGame).mockImplementation(() => {
      throw new Error("db closed")
    })
    const res = await POST(jsonRequest("POST", { appid: 274920 }))
    expect(res.status).toBe(500)
  })
})

describe("DELETE /api/admin/pinned-games", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await DELETE(jsonRequest("DELETE", { appid: 274920 }))
    expect(res.status).toBe(403)
  })

  it("returns 400 on invalid JSON body", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await DELETE(jsonRequest("DELETE", "not json"))
    expect(res.status).toBe(400)
  })

  it("returns 400 when appid is not a positive integer", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await DELETE(jsonRequest("DELETE", { appid: "abc" }))
    expect(res.status).toBe(400)
  })

  it("calls removePinnedGame and returns success", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    vi.mocked(removePinnedGame).mockClear()
    const res = await DELETE(jsonRequest("DELETE", { appid: 274920 }))
    expect(res.status).toBe(200)
    expect(removePinnedGame).toHaveBeenCalledWith(274920)
  })

  it("returns 500 if removePinnedGame throws", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    vi.mocked(removePinnedGame).mockImplementation(() => {
      throw new Error("db closed")
    })
    const res = await DELETE(jsonRequest("DELETE", { appid: 274920 }))
    expect(res.status).toBe(500)
  })
})
