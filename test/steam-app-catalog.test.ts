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
const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_KEY = process.env.STEAM_API_KEY

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-catalog-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  process.env.STEAM_API_KEY = "test-key"
  vi.resetModules()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  delete process.env.SQLITE_PATH
  if (ORIGINAL_KEY === undefined) delete process.env.STEAM_API_KEY
  else process.env.STEAM_API_KEY = ORIGINAL_KEY
  rmSync(tmpDir, { recursive: true, force: true })
})

/**
 * Mocks IStoreService/GetAppList as a single page of results. Any non-API
 * host gets a fail response so the caller crashes loudly if something other
 * than the catalog fetch tries to use the network.
 */
function mockCatalogPage(apps: Array<{ appid: number; name: string }>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.hostname !== "api.steampowered.com") {
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as unknown as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        response: { apps, have_more_results: false },
      }),
    } as unknown as Response
  }) as unknown as typeof fetch
}

describe("populateGamesFromSteamCatalog", () => {
  it("inserts every catalog entry into games on the first call", async () => {
    mockCatalogPage([
      { appid: 745, name: "Dota 2 Workshop Tools" },
      { appid: 620, name: "Portal 2" },
      { appid: 440, name: "Team Fortress 2" },
    ])

    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const { populateGamesFromSteamCatalog } = await import("@/lib/server/steam-app-catalog")

    const inserted = await populateGamesFromSteamCatalog()
    expect(inserted).toBe(3)

    const rows = db.prepare("SELECT appid, name FROM games ORDER BY appid").all() as Array<{
      appid: number
      name: string
    }>
    expect(rows).toEqual([
      { appid: 440, name: "Team Fortress 2" },
      { appid: 620, name: "Portal 2" },
      { appid: 745, name: "Dota 2 Workshop Tools" },
    ])

    const meta = db.prepare("SELECT entry_count FROM app_catalog_meta WHERE id = 1").get() as {
      entry_count: number
    }
    expect(meta.entry_count).toBe(3)
  })

  it("is a no-op on subsequent calls inside the 7-day TTL", async () => {
    mockCatalogPage([{ appid: 745, name: "Dota 2 Workshop Tools" }])

    const { populateGamesFromSteamCatalog } = await import("@/lib/server/steam-app-catalog")

    const first = await populateGamesFromSteamCatalog()
    expect(first).toBe(1)

    const callsBefore = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length

    const second = await populateGamesFromSteamCatalog()
    expect(second).toBe(0)

    const callsAfter = (globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length
    expect(callsAfter).toBe(callsBefore)
  })

  it("re-fetches after the 7-day TTL has elapsed", async () => {
    mockCatalogPage([{ appid: 745, name: "Dota 2 Workshop Tools" }])

    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const { populateGamesFromSteamCatalog, __resetSteamAppCatalogForTests } =
      await import("@/lib/server/steam-app-catalog")

    await populateGamesFromSteamCatalog()

    // Back-date the meta row so the TTL check treats it as stale.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    db.prepare("UPDATE app_catalog_meta SET populated_at = ? WHERE id = 1").run(eightDaysAgo)

    // Clear the in-memory catalog cache so we exercise the full fetch path.
    __resetSteamAppCatalogForTests()

    mockCatalogPage([
      { appid: 745, name: "Dota 2 Workshop Tools" },
      { appid: 12345, name: "Brand New Tool" },
    ])

    const secondInserted = await populateGamesFromSteamCatalog()
    expect(secondInserted).toBe(1)

    const newRow = db.prepare("SELECT name FROM games WHERE appid = 12345").get() as { name: string }
    expect(newRow.name).toBe("Brand New Tool")
  })

  it("does not overwrite existing games rows with catalog data (INSERT OR IGNORE)", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const now = new Date().toISOString()

    db.prepare(
      `INSERT INTO games (appid, name, image_landscape_url, created_at, updated_at)
       VALUES (620, 'Portal 2 ES', 'https://cdn.example/portal2.jpg', ?, ?)`,
    ).run(now, now)

    mockCatalogPage([{ appid: 620, name: "Portal 2" }])

    const { populateGamesFromSteamCatalog } = await import("@/lib/server/steam-app-catalog")
    await populateGamesFromSteamCatalog()

    const row = db.prepare("SELECT name, image_landscape_url FROM games WHERE appid = 620").get() as {
      name: string
      image_landscape_url: string | null
    }
    expect(row.name).toBe("Portal 2 ES")
    expect(row.image_landscape_url).toBe("https://cdn.example/portal2.jpg")
  })

  it("returns 0 and writes nothing when the catalog fetch fails", async () => {
    globalThis.fetch = vi.fn(async () => {
      return { ok: false, status: 500, json: async () => ({}), text: async () => "" } as unknown as Response
    }) as unknown as typeof fetch

    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const { populateGamesFromSteamCatalog } = await import("@/lib/server/steam-app-catalog")

    const inserted = await populateGamesFromSteamCatalog()
    expect(inserted).toBe(0)

    const count = db.prepare("SELECT COUNT(*) as c FROM games").get() as { c: number }
    expect(count.c).toBe(0)

    const meta = db.prepare("SELECT populated_at FROM app_catalog_meta WHERE id = 1").get()
    expect(meta).toBeUndefined()
  })

  it("paginates through multiple catalog pages via last_appid", async () => {
    const pages = [
      {
        apps: [{ appid: 100, name: "Game 100" }],
        have_more_results: true,
        last_appid: 100,
      },
      {
        apps: [{ appid: 200, name: "Game 200" }],
        have_more_results: true,
        last_appid: 200,
      },
      {
        apps: [{ appid: 300, name: "Game 300" }],
        have_more_results: false,
      },
    ]
    let pageIndex = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.hostname !== "api.steampowered.com") {
        return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as unknown as Response
      }
      const page = pages[pageIndex++] ?? pages[pages.length - 1]
      return {
        ok: true,
        status: 200,
        json: async () => ({ response: page }),
      } as unknown as Response
    }) as unknown as typeof fetch

    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const { populateGamesFromSteamCatalog } = await import("@/lib/server/steam-app-catalog")

    const inserted = await populateGamesFromSteamCatalog()
    expect(inserted).toBe(3)
    const rows = db.prepare("SELECT appid FROM games ORDER BY appid").all() as Array<{ appid: number }>
    expect(rows.map((r) => r.appid)).toEqual([100, 200, 300])
  })
})

describe("hydrateMissingExtraNames + catalog bulk-populate", () => {
  const STEAM_ID = "76561198023709299"

  async function seedProfileWithExtra(appId: number) {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const now = new Date().toISOString()
    db.prepare("INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)").run(STEAM_ID, now, now)
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
       VALUES (?, ?, 500, ?, ?, ?)`,
    ).run(STEAM_ID, appId, now, now, now)
    return db
  }

  it("resolves a Tool appid via the catalog without hitting store/schema/community", async () => {
    const db = await seedProfileWithExtra(745)

    const hosts: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      hosts.push(url.hostname)
      if (url.hostname === "api.steampowered.com") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            response: {
              apps: [{ appid: 745, name: "Dota 2 Workshop Tools" }],
              have_more_results: false,
            },
          }),
        } as unknown as Response
      }
      return { ok: false, status: 500, json: async () => ({}), text: async () => "" } as unknown as Response
    }) as unknown as typeof fetch

    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)

    const row = db.prepare("SELECT name FROM games WHERE appid = 745").get() as { name: string } | undefined
    expect(row?.name).toBe("Dota 2 Workshop Tools")

    // No per-appid fallback calls should have fired, since the bulk populate
    // landed the name before the per-appid loop got a chance to look.
    expect(hosts).not.toContain("store.steampowered.com")
    expect(hosts).not.toContain("steamcommunity.com")
  })
})
