// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"

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
  prepare: vi.fn().mockReturnValue({
    all: vi.fn().mockReturnValue([]),
    run: vi.fn(),
    get: vi.fn().mockReturnValue({ 1: 1 }),
  }),
}
vi.mock("@/lib/server/sqlite", () => ({
  getSqliteDatabase: () => mockDb,
}))

vi.mock("@/lib/server/steam-store-utils", () => ({
  upsertProfile: vi.fn(),
}))

import { GET, POST, DELETE, PATCH } from "@/app/api/admin/users/route"
import { requireAdmin } from "@/app/lib/require-admin"

const ORIGINAL_FETCH = globalThis.fetch

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

describe("PATCH /api/admin/users", () => {
  function patchReq(body: unknown) {
    return new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  }

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await PATCH(patchReq({ steamId: "76561198000000099" }))
    expect(res.status).toBe(403)
  })

  it("returns 400 on malformed JSON", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await PATCH(patchReq("{not json"))
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid Steam ID", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await PATCH(patchReq({ steamId: "abc" }))
    expect(res.status).toBe(400)
  })

  it("returns 404 when the user is not in the allowed list", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    mockDb.prepare.mockReturnValueOnce({
      all: vi.fn(),
      run: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as ReturnType<typeof mockDb.prepare>)
    const res = await PATCH(patchReq({ steamId: "76561198000000099" }))
    expect(res.status).toBe(404)
  })

  it("returns 502 when Steam profile fetch fails (non-ok)", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    mockDb.prepare.mockReturnValueOnce({
      all: vi.fn(),
      run: vi.fn(),
      get: vi.fn().mockReturnValue({ 1: 1 }),
    } as unknown as ReturnType<typeof mockDb.prepare>)
    globalThis.fetch = vi.fn(
      async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response,
    ) as typeof fetch
    process.env.STEAM_API_KEY = "fake"
    const res = await PATCH(patchReq({ steamId: "76561198000000099" }))
    expect(res.status).toBe(502)
  })

  it("returns 502 when Steam profile fetch rejects", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    mockDb.prepare.mockReturnValueOnce({
      all: vi.fn(),
      run: vi.fn(),
      get: vi.fn().mockReturnValue({ 1: 1 }),
    } as unknown as ReturnType<typeof mockDb.prepare>)
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network")
    }) as typeof fetch
    process.env.STEAM_API_KEY = "fake"
    const res = await PATCH(patchReq({ steamId: "76561198000000099" }))
    expect(res.status).toBe(502)
  })

  it("returns 200 with the profile on success", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    mockDb.prepare.mockReturnValueOnce({
      all: vi.fn(),
      run: vi.fn(),
      get: vi.fn().mockReturnValue({ 1: 1 }),
    } as unknown as ReturnType<typeof mockDb.prepare>)
    globalThis.fetch = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            response: {
              players: [
                {
                  personaname: "Tester",
                  avatarfull: "https://example.com/a.jpg",
                  profileurl: "https://steamcommunity.com/id/tester",
                },
              ],
            },
          }),
        }) as Response,
    ) as typeof fetch
    process.env.STEAM_API_KEY = "fake"
    const res = await PATCH(patchReq({ steamId: "76561198000000099" }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { success: boolean; profile: { persona_name: string } }
    expect(body.success).toBe(true)
    expect(body.profile.persona_name).toBe("Tester")
  })
})
