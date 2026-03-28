// @vitest-environment node
import { describe, expect, it, vi } from "vitest"

const { mockGetSqliteDatabase } = vi.hoisted(() => {
  return { mockGetSqliteDatabase: vi.fn() }
})

vi.mock("@/lib/server/sqlite", () => ({
  getSqliteDatabase: mockGetSqliteDatabase,
}))

import { GET } from "@/app/api/health/route"

describe("GET /api/health", () => {
  it("returns 200 with status ok when DB is accessible", async () => {
    mockGetSqliteDatabase.mockReturnValue({
      prepare: () => ({ get: () => ({}) }),
    })

    const response = await GET()
    const body = (await response.json()) as { status: string; timestamp: string }

    expect(response.status).toBe(200)
    expect(body.status).toBe("ok")
    expect(body.timestamp).toBeDefined()
    expect(() => new Date(body.timestamp)).not.toThrow()
  })

  it("returns 503 when DB throws an error", async () => {
    mockGetSqliteDatabase.mockImplementation(() => {
      throw new Error("Database unavailable")
    })

    const response = await GET()
    const body = (await response.json()) as { status: string; message: string }

    expect(response.status).toBe(503)
    expect(body.status).toBe("error")
    expect(body.message).toBe("Database unavailable")
  })
})
