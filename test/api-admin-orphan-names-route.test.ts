// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest"

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

vi.mock("@/lib/server/orphan-names", () => ({
  listOrphanNames: vi.fn(),
  setManualName: vi.fn(),
  clearManualName: vi.fn(),
}))

import { GET } from "@/app/api/admin/orphan-names/route"
import { PUT, DELETE } from "@/app/api/admin/orphan-names/[appid]/route"
import { requireAdmin } from "@/app/lib/require-admin"
import { listOrphanNames, setManualName, clearManualName } from "@/lib/server/orphan-names"

const mockAdmin = {
  steamId: "76561198023709299",
  displayName: "admin",
  avatar: "",
  profileUrl: "",
}

function paramsFor(appid: string | number) {
  return { params: Promise.resolve({ appid: String(appid) }) }
}

function jsonRequest(method: string, body: unknown) {
  return new Request("http://localhost/api/admin/orphan-names/123", {
    method,
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset()
  vi.mocked(listOrphanNames).mockReset()
  vi.mocked(setManualName).mockReset()
  vi.mocked(clearManualName).mockReset()
})

describe("GET /api/admin/orphan-names", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it("returns the list for an admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    vi.mocked(listOrphanNames).mockReturnValue([
      {
        appid: 489890,
        current_name: "",
        sources: ["extras"],
        playtime_forever: 200,
        rtime_first_played: null,
        rtime_last_played: null,
      },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orphans).toHaveLength(1)
    expect(body.orphans[0].appid).toBe(489890)
  })

  it("returns 500 when listOrphanNames throws", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    vi.mocked(listOrphanNames).mockImplementation(() => {
      throw new Error("db down")
    })
    const res = await GET()
    expect(res.status).toBe(500)
  })
})

describe("PUT /api/admin/orphan-names/[appid]", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await PUT(jsonRequest("PUT", { name: "X" }), paramsFor(123))
    expect(res.status).toBe(403)
  })

  it("returns 400 for a non-numeric appid", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await PUT(jsonRequest("PUT", { name: "X" }), paramsFor("abc"))
    expect(res.status).toBe(400)
  })

  it("returns 400 for a non-positive appid", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await PUT(jsonRequest("PUT", { name: "X" }), paramsFor("0"))
    expect(res.status).toBe(400)
  })

  it("returns 400 for invalid JSON body", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await PUT(jsonRequest("PUT", "not-json {"), paramsFor(123))
    expect(res.status).toBe(400)
  })

  it("returns 400 when name is not a string", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await PUT(jsonRequest("PUT", { name: 42 }), paramsFor(123))
    expect(res.status).toBe(400)
  })

  it("forwards RangeError from setManualName as 400", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    vi.mocked(setManualName).mockImplementation(() => {
      throw new RangeError("Name must be between 1 and 200 characters")
    })
    const res = await PUT(jsonRequest("PUT", { name: "" }), paramsFor(123))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("between 1 and 200")
  })

  it("returns 200 and calls setManualName on happy path", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await PUT(jsonRequest("PUT", { name: "Hello" }), paramsFor(123))
    expect(res.status).toBe(200)
    expect(setManualName).toHaveBeenCalledWith(123, "Hello")
  })
})

describe("DELETE /api/admin/orphan-names/[appid]", () => {
  it("returns 403 when not admin", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null)
    const res = await DELETE(jsonRequest("DELETE", ""), paramsFor(123))
    expect(res.status).toBe(403)
  })

  it("returns 400 for invalid appid", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await DELETE(jsonRequest("DELETE", ""), paramsFor("xyz"))
    expect(res.status).toBe(400)
  })

  it("returns 200 and calls clearManualName on happy path", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(mockAdmin)
    const res = await DELETE(jsonRequest("DELETE", ""), paramsFor(123))
    expect(res.status).toBe(200)
    expect(clearManualName).toHaveBeenCalledWith(123)
  })
})
