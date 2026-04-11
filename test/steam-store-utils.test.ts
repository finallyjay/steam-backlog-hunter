// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

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

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-utils-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("nowIso", () => {
  it("returns an ISO-8601 string parseable by Date", async () => {
    const { nowIso } = await import("@/lib/server/steam-store-utils")
    const iso = nowIso()
    expect(typeof iso).toBe("string")
    expect(Number.isNaN(Date.parse(iso))).toBe(false)
  })
})

describe("nullIfUndefined", () => {
  it("maps undefined → null and passes everything else through", async () => {
    const { nullIfUndefined } = await import("@/lib/server/steam-store-utils")
    expect(nullIfUndefined(undefined)).toBeNull()
    expect(nullIfUndefined(null)).toBeNull()
    expect(nullIfUndefined(0)).toBe(0)
    expect(nullIfUndefined("")).toBe("")
    expect(nullIfUndefined(false)).toBe(false)
  })
})

describe("isStale", () => {
  it("returns true for null / undefined / unparseable timestamps", async () => {
    const { isStale } = await import("@/lib/server/steam-store-utils")
    expect(isStale(null, 1_000)).toBe(true)
    expect(isStale(undefined, 1_000)).toBe(true)
    expect(isStale("not a date", 1_000)).toBe(true)
  })

  it("returns false when the timestamp is within the allowed window", async () => {
    const { isStale } = await import("@/lib/server/steam-store-utils")
    const recent = new Date(Date.now() - 100).toISOString()
    expect(isStale(recent, 60_000)).toBe(false)
  })

  it("returns true when the timestamp is outside the allowed window", async () => {
    const { isStale } = await import("@/lib/server/steam-store-utils")
    const old = new Date(Date.now() - 120_000).toISOString()
    expect(isStale(old, 60_000)).toBe(true)
  })
})

describe("parseJson", () => {
  it("returns null for null / undefined / empty string", async () => {
    const { parseJson } = await import("@/lib/server/steam-store-utils")
    expect(parseJson(null)).toBeNull()
    expect(parseJson(undefined)).toBeNull()
    expect(parseJson("")).toBeNull()
  })

  it("returns the parsed value on valid JSON", async () => {
    const { parseJson } = await import("@/lib/server/steam-store-utils")
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
    expect(parseJson<number[]>("[1,2,3]")).toEqual([1, 2, 3])
  })

  it("returns null on malformed JSON without throwing", async () => {
    const { parseJson } = await import("@/lib/server/steam-store-utils")
    expect(parseJson("{not json")).toBeNull()
  })
})

describe("roundPercent", () => {
  it("floors the value", async () => {
    const { roundPercent } = await import("@/lib/server/steam-store-utils")
    expect(roundPercent(77.9)).toBe(77)
    expect(roundPercent(0)).toBe(0)
    expect(roundPercent(100)).toBe(100)
  })
})

describe("upsertProfile", () => {
  it("inserts a fresh profile when no row exists", async () => {
    const { upsertProfile, getProfileSync } = await import("@/lib/server/steam-store-utils")
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")

    upsertProfile("76561198000000001", {
      personaName: "Tester",
      avatarUrl: "https://example.com/a.jpg",
      profileUrl: "https://example.com/profile",
      lastLoginAt: "2026-04-11T00:00:00.000Z",
    })

    const db = getSqliteDatabase()
    const row = db
      .prepare("SELECT persona_name, avatar_url FROM steam_profile WHERE steam_id = ?")
      .get("76561198000000001") as { persona_name: string; avatar_url: string } | undefined
    expect(row?.persona_name).toBe("Tester")
    expect(row?.avatar_url).toBe("https://example.com/a.jpg")

    // Initial sync columns are null
    expect(getProfileSync("76561198000000001")?.last_owned_games_sync_at).toBeNull()
  })

  it("preserves existing fields on update when the new value is undefined (COALESCE)", async () => {
    const { upsertProfile } = await import("@/lib/server/steam-store-utils")
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")

    upsertProfile("76561198000000001", { personaName: "Original", avatarUrl: "https://example.com/a.jpg" })
    upsertProfile("76561198000000001", { personaName: "Updated" })

    const db = getSqliteDatabase()
    const row = db
      .prepare("SELECT persona_name, avatar_url FROM steam_profile WHERE steam_id = ?")
      .get("76561198000000001") as { persona_name: string; avatar_url: string }
    expect(row.persona_name).toBe("Updated")
    expect(row.avatar_url).toBe("https://example.com/a.jpg")
  })

  it("accepts no options at all (bootstrap before login)", async () => {
    const { upsertProfile } = await import("@/lib/server/steam-store-utils")
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    upsertProfile("76561198000000002")
    const db = getSqliteDatabase()
    const row = db.prepare("SELECT persona_name FROM steam_profile WHERE steam_id = ?").get("76561198000000002") as {
      persona_name: string | null
    }
    expect(row.persona_name).toBeNull()
  })
})

describe("markProfileSync", () => {
  it("sets the requested column and touches updated_at", async () => {
    const { upsertProfile, markProfileSync, getProfileSync } = await import("@/lib/server/steam-store-utils")
    upsertProfile("76561198000000003")
    markProfileSync("76561198000000003", "last_owned_games_sync_at", "2026-04-11T10:00:00.000Z")
    expect(getProfileSync("76561198000000003")?.last_owned_games_sync_at).toBe("2026-04-11T10:00:00.000Z")
  })

  it("updates last_recent_games_sync_at independently of owned-games sync", async () => {
    const { upsertProfile, markProfileSync, getProfileSync } = await import("@/lib/server/steam-store-utils")
    upsertProfile("76561198000000004")
    markProfileSync("76561198000000004", "last_recent_games_sync_at", "2026-04-11T11:00:00.000Z")
    const sync = getProfileSync("76561198000000004")
    expect(sync?.last_recent_games_sync_at).toBe("2026-04-11T11:00:00.000Z")
    expect(sync?.last_owned_games_sync_at).toBeNull()
  })
})

describe("getProfileSync", () => {
  it("returns undefined when no profile exists", async () => {
    const { getProfileSync } = await import("@/lib/server/steam-store-utils")
    expect(getProfileSync("76561198999999999")).toBeUndefined()
  })
})
