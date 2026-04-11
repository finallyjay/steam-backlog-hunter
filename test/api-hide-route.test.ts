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

const mockDb = {
  prepare: vi.fn().mockReturnValue({ run: vi.fn() }),
}
vi.mock("@/lib/server/sqlite", () => ({
  getSqliteDatabase: () => mockDb,
}))

import { POST, DELETE } from "@/app/api/steam/games/hide/route"
import { getCurrentUser } from "@/app/lib/server-auth"

const mockUser = { steamId: "76561198023709299", displayName: "test", avatar: "", profileUrl: "" }

describe("POST /api/steam/games/hide", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const res = await POST(
      new Request("http://localhost/api/steam/games/hide", {
        method: "POST",
        body: JSON.stringify({ appId: 730 }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid JSON", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await POST(
      new Request("http://localhost/api/steam/games/hide", {
        method: "POST",
        body: "not json",
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for negative appId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await POST(
      new Request("http://localhost/api/steam/games/hide", {
        method: "POST",
        body: JSON.stringify({ appId: -1 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for float appId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await POST(
      new Request("http://localhost/api/steam/games/hide", {
        method: "POST",
        body: JSON.stringify({ appId: 1.5 }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 200 for valid appId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await POST(
      new Request("http://localhost/api/steam/games/hide", {
        method: "POST",
        body: JSON.stringify({ appId: 730 }),
      }),
    )
    expect(res.status).toBe(200)
    expect(mockDb.prepare).toHaveBeenCalled()
  })
})

describe("DELETE /api/steam/games/hide", () => {
  it("returns 401 when not authenticated", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const res = await DELETE(
      new Request("http://localhost/api/steam/games/hide", {
        method: "DELETE",
        body: JSON.stringify({ appId: 730 }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 for invalid JSON", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await DELETE(
      new Request("http://localhost/api/steam/games/hide", {
        method: "DELETE",
        body: "not json",
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid appId", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await DELETE(
      new Request("http://localhost/api/steam/games/hide", {
        method: "DELETE",
        body: JSON.stringify({ appId: "abc" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 200 for valid unhide", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    const res = await DELETE(
      new Request("http://localhost/api/steam/games/hide", {
        method: "DELETE",
        body: JSON.stringify({ appId: 730 }),
      }),
    )
    expect(res.status).toBe(200)
  })

  it("returns 500 when the db throws on hide", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    mockDb.prepare.mockReturnValueOnce({
      run: vi.fn().mockImplementation(() => {
        throw new Error("db down")
      }),
    } as unknown as ReturnType<typeof mockDb.prepare>)
    const res = await POST(
      new Request("http://localhost/api/steam/games/hide", {
        method: "POST",
        body: JSON.stringify({ appId: 730 }),
      }),
    )
    expect(res.status).toBe(500)
  })

  it("returns 500 when the db throws on unhide", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(mockUser)
    mockDb.prepare.mockReturnValueOnce({
      run: vi.fn().mockImplementation(() => {
        throw new Error("db down")
      }),
    } as unknown as ReturnType<typeof mockDb.prepare>)
    const res = await DELETE(
      new Request("http://localhost/api/steam/games/hide", {
        method: "DELETE",
        body: JSON.stringify({ appId: 730 }),
      }),
    )
    expect(res.status).toBe(500)
  })
})
