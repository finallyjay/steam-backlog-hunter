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

vi.mock("@/lib/server/steam-store", () => ({
  listAchievementChanges: vi.fn(),
  markAchievementChangesSeen: vi.fn(),
}))

import { NextRequest } from "next/server"
import { GET, PATCH } from "@/app/api/steam/achievements/changes/route"
import { getCurrentUser } from "@/app/lib/server-auth"
import { listAchievementChanges, markAchievementChangesSeen } from "@/lib/server/steam-store"

const mockUser = {
  steamId: "76561198023709299",
  displayName: "test",
  avatar: "",
  profileUrl: "",
}

const sampleChange = {
  id: 1,
  appId: 620,
  gameName: "Portal 2",
  added: ["ACH_THREE"],
  removed: [],
  totalBefore: 2,
  totalAfter: 3,
  wasPerfect: true,
  detectedAt: "2026-09-05T00:00:00.000Z",
  seenAt: null,
}

function makeGet(query = "") {
  return new NextRequest(`http://localhost/api/steam/achievements/changes${query}`)
}

function makePatch(body?: string) {
  return new NextRequest("http://localhost/api/steam/achievements/changes", {
    method: "PATCH",
    body,
    headers: body ? { "content-type": "application/json" } : undefined,
  })
}

beforeEach(() => {
  vi.mocked(getCurrentUser).mockReset()
  vi.mocked(listAchievementChanges).mockReset()
  vi.mocked(markAchievementChangesSeen).mockReset()
})

describe("GET /api/steam/achievements/changes", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const response = await GET(makeGet())
    expect(response.status).toBe(401)
    expect(listAchievementChanges).not.toHaveBeenCalled()
  })

  it("returns all changes by default", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(listAchievementChanges).mockReturnValue([sampleChange])

    const response = await GET(makeGet())
    const body = (await response.json()) as { changes: unknown[] }

    expect(response.status).toBe(200)
    expect(body.changes).toEqual([sampleChange])
    expect(listAchievementChanges).toHaveBeenCalledWith(mockUser.steamId, { unseenOnly: false, limit: undefined })
  })

  it("passes unseen=1 and a numeric limit through", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(listAchievementChanges).mockReturnValue([])

    await GET(makeGet("?unseen=1&limit=5"))
    expect(listAchievementChanges).toHaveBeenCalledWith(mockUser.steamId, { unseenOnly: true, limit: 5 })
  })

  it("ignores a non-numeric limit", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(listAchievementChanges).mockReturnValue([])

    await GET(makeGet("?limit=abc"))
    expect(listAchievementChanges).toHaveBeenCalledWith(mockUser.steamId, { unseenOnly: false, limit: undefined })
  })

  it("returns 500 when the store throws", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(listAchievementChanges).mockImplementation(() => {
      throw new Error("boom")
    })

    const response = await GET(makeGet())
    expect(response.status).toBe(500)
  })
})

describe("PATCH /api/steam/achievements/changes", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    const response = await PATCH(makePatch())
    expect(response.status).toBe(401)
    expect(markAchievementChangesSeen).not.toHaveBeenCalled()
  })

  it("marks all unseen changes when the body is empty", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(markAchievementChangesSeen).mockReturnValue(3)

    const response = await PATCH(makePatch())
    const body = (await response.json()) as { updated: number }

    expect(response.status).toBe(200)
    expect(body.updated).toBe(3)
    expect(markAchievementChangesSeen).toHaveBeenCalledWith(mockUser.steamId, undefined)
  })

  it("marks the given ids", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    vi.mocked(markAchievementChangesSeen).mockReturnValue(2)

    const response = await PATCH(makePatch(JSON.stringify({ ids: [1, 2] })))
    expect(response.status).toBe(200)
    expect(markAchievementChangesSeen).toHaveBeenCalledWith(mockUser.steamId, [1, 2])
  })

  it("rejects malformed JSON", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)

    const response = await PATCH(makePatch("{not json"))
    expect(response.status).toBe(400)
    expect(markAchievementChangesSeen).not.toHaveBeenCalled()
  })

  it("rejects ids that are not positive integers", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)

    for (const ids of [[1, "2"], [0], [-1], "1", [1.5]]) {
      const response = await PATCH(makePatch(JSON.stringify({ ids })))
      expect(response.status).toBe(400)
    }
    expect(markAchievementChangesSeen).not.toHaveBeenCalled()
  })
})
