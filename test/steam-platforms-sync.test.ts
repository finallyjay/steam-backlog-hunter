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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-platforms-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
  // @ts-expect-error restore globals
  delete globalThis.fetch
})

const STEAM_ID = "76561198023709299"

async function seed(appid: number) {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(STEAM_ID, now, now)
  db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
    appid,
    `App ${appid}`,
    now,
    now,
  )
  db.prepare(
    `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
     VALUES (?, ?, 0, 1, ?, ?)`,
  ).run(STEAM_ID, appid, now, now)
  return db
}

describe("syncGamePlatforms", () => {
  it("requests filters=platforms,release_date (basic does NOT include those fields)", async () => {
    await seed(12100)
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        "12100": { success: true, data: { platforms: { windows: true, mac: false, linux: false } } },
      }),
    })
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const { syncGamePlatforms } = await import("@/lib/server/steam-platforms-sync")
    await syncGamePlatforms(STEAM_ID)

    const url = String(fetchSpy.mock.calls[0]?.[0])
    expect(url).toContain("filters=platforms%2Crelease_date")
    expect(url).not.toContain("filters=basic")
  })

  it("persists platforms JSON and release year when the store responds with both", async () => {
    const db = await seed(12100)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        "12100": {
          success: true,
          data: {
            platforms: { windows: true, mac: true, linux: false },
            release_date: { coming_soon: false, date: "4 Jan, 2008" },
          },
        },
      }),
    }) as unknown as typeof fetch

    const { syncGamePlatforms } = await import("@/lib/server/steam-platforms-sync")
    await syncGamePlatforms(STEAM_ID)

    const row = db
      .prepare("SELECT platforms, release_year, platforms_synced_at FROM games WHERE appid = 12100")
      .get() as { platforms: string | null; release_year: number | null; platforms_synced_at: string | null }
    expect(row.platforms).toBe(JSON.stringify({ windows: true, mac: true, linux: false }))
    expect(row.release_year).toBe(2008)
    expect(row.platforms_synced_at).not.toBeNull()
  })

  it("stores release_year=NULL when Steam returns an empty release_date (legacy stripped listing)", async () => {
    // GTA III appid 12230 in the wild: success=true, platforms reports
    // windows-only, but release_date.date is "". This is the signal that
    // surfaces a "Legacy" badge in the UI when name+platforms collide
    // with a sibling appid.
    const db = await seed(12230)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        "12230": {
          success: true,
          data: {
            platforms: { windows: true, mac: false, linux: false },
            release_date: { coming_soon: false, date: "" },
          },
        },
      }),
    }) as unknown as typeof fetch

    const { syncGamePlatforms } = await import("@/lib/server/steam-platforms-sync")
    await syncGamePlatforms(STEAM_ID)

    const row = db.prepare("SELECT platforms, release_year FROM games WHERE appid = 12230").get() as {
      platforms: string | null
      release_year: number | null
    }
    expect(row.platforms).toBe(JSON.stringify({ windows: true, mac: false, linux: false }))
    expect(row.release_year).toBeNull()
  })

  it("parses just the year out of Steam's localized release_date strings", async () => {
    const cases: Array<{ raw: string; year: number | null }> = [
      { raw: "4 Jan, 2008", year: 2008 },
      { raw: "Jan 4, 2008", year: 2008 },
      { raw: "2008", year: 2008 },
      { raw: "Q4 2024", year: 2024 },
      { raw: "To be announced", year: null },
      { raw: "", year: null },
    ]

    for (const { raw, year } of cases) {
      tmpDir = mkdtempSync(join(tmpdir(), "sbh-platforms-test-"))
      process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
      vi.resetModules()

      const db = await seed(1)
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          "1": {
            success: true,
            data: {
              platforms: { windows: true, mac: false, linux: false },
              release_date: { coming_soon: false, date: raw },
            },
          },
        }),
      }) as unknown as typeof fetch

      const { syncGamePlatforms } = await import("@/lib/server/steam-platforms-sync")
      await syncGamePlatforms(STEAM_ID)

      const row = db.prepare("SELECT release_year FROM games WHERE appid = 1").get() as { release_year: number | null }
      expect(row.release_year).toBe(year)
    }
  })

  it("negative-caches delisted apps as platforms=NULL with synced_at set", async () => {
    const db = await seed(99999)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ "99999": { success: false } }),
    }) as unknown as typeof fetch

    const { syncGamePlatforms } = await import("@/lib/server/steam-platforms-sync")
    await syncGamePlatforms(STEAM_ID)

    const row = db.prepare("SELECT platforms, platforms_synced_at FROM games WHERE appid = 99999").get() as {
      platforms: string | null
      platforms_synced_at: string | null
    }
    expect(row.platforms).toBeNull()
    expect(row.platforms_synced_at).not.toBeNull()
  })

  it("does NOT mark the row synced when the response succeeds but lacks the platforms field", async () => {
    // Pre-fix regression: with filters=basic the response had success=true
    // but no platforms key, and the code silently skipped the upsert, so
    // platforms_synced_at stayed NULL forever. The fix flips the filter to
    // `platforms`, but this guard locks in the behaviour for any future
    // payload shape that omits the field.
    const db = await seed(12100)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ "12100": { success: true, data: { name: "Grand Theft Auto III" } } }),
    }) as unknown as typeof fetch

    const { syncGamePlatforms } = await import("@/lib/server/steam-platforms-sync")
    await syncGamePlatforms(STEAM_ID)

    const row = db.prepare("SELECT platforms, platforms_synced_at FROM games WHERE appid = 12100").get() as {
      platforms: string | null
      platforms_synced_at: string | null
    }
    expect(row.platforms).toBeNull()
    expect(row.platforms_synced_at).toBeNull()
  })
})
