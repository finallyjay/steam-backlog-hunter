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

const mockDb = {
  prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), run: vi.fn() }),
}
vi.mock("@/lib/server/sqlite", () => ({
  getSqliteDatabase: () => mockDb,
}))

import { GET, POST, DELETE } from "@/app/api/admin/users/route"
import { requireAdmin } from "@/app/lib/require-admin"

const mockAdmin = { steamId: "76561198000000001", displayName: "admin", avatar: "", profileUrl: "" }

describe("GET /api/admin/users", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it("returns users list", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await GET()
    expect(res.status).toBe(200)
  })
})

describe("POST /api/admin/users", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await POST(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ steamId: "76561198000000099" }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it("returns 400 for invalid JSON", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await POST(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        body: "not json",
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for null body", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await POST(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "null",
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid Steam ID", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await POST(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ steamId: "123" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 200 for valid add", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await POST(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ steamId: "76561198000000099" }),
      }),
    )
    expect(res.status).toBe(200)
  })
})

describe("DELETE /api/admin/users", () => {
  it("returns 400 for invalid Steam ID format", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await DELETE(
      new Request("http://localhost/api/admin/users", {
        method: "DELETE",
        body: JSON.stringify({ steamId: "abc" }),
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 400 when trying to remove yourself", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await DELETE(
      new Request("http://localhost/api/admin/users", {
        method: "DELETE",
        body: JSON.stringify({ steamId: mockAdmin.steamId }),
      }),
    )
    const body = (await res.json()) as { error: string }
    expect(res.status).toBe(400)
    expect(body.error).toBe("Cannot remove yourself")
  })

  it("returns 200 for valid remove", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await DELETE(
      new Request("http://localhost/api/admin/users", {
        method: "DELETE",
        body: JSON.stringify({ steamId: "76561198000000099" }),
      }),
    )
    expect(res.status).toBe(200)
  })
})
