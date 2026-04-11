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

const ORIGINAL_FETCH = globalThis.fetch
let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-extras-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198023709299"

async function seedProfile() {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(STEAM_ID, now, now)
  return db
}

function mockStoreAppDetails(handler: (appids: string) => Record<string, unknown>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const appids = url.searchParams.get("appids") ?? ""
    return {
      ok: true,
      status: 200,
      json: async () => handler(appids),
    } as unknown as Response
  }) as unknown as typeof fetch
}

describe("persistExtraGames", () => {
  it("is a no-op when given an empty list", async () => {
    await seedProfile()
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    await persistExtraGames(STEAM_ID, [])
    expect(getExtraGamesForUser(STEAM_ID)).toEqual([])
  })

  it("upserts unowned + non-pinned games with playtime > 0", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    // An owned game (should be skipped)
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
       VALUES (?, 620, 1000, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)
    mockStoreAppDetails((appids) => {
      const ids = appids.split(",").map(Number)
      const out: Record<string, unknown> = {}
      for (const id of ids) {
        out[String(id)] = { success: true, data: { name: `Game ${id}`, type: "game" } }
      }
      return out
    })

    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    await persistExtraGames(STEAM_ID, [
      // Already owned — must be skipped
      { appid: 620, playtime_forever: 1000, first_playtime: 1, last_playtime: 2 },
      // Extras
      { appid: 111, playtime_forever: 500, first_playtime: 100, last_playtime: 200 },
      { appid: 222, playtime_forever: 50, first_playtime: 300, last_playtime: 400 },
      // Zero-playtime → skipped (launcher hover)
      { appid: 333, playtime_forever: 0 },
    ])

    const extras = getExtraGamesForUser(STEAM_ID)
    expect(extras.map((e) => e.appid)).toEqual([111, 222])
    expect(extras[0]).toMatchObject({
      appid: 111,
      playtime_forever: 500,
      rtime_first_played: 100,
      rtime_last_played: 200,
      name: "Game 111",
    })
  })

  it("sorts by playtime_forever DESC, then by rtime_last_played DESC", async () => {
    await seedProfile()
    mockStoreAppDetails(() => ({}))
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    await persistExtraGames(STEAM_ID, [
      { appid: 1, playtime_forever: 100 },
      { appid: 2, playtime_forever: 500 },
      { appid: 3, playtime_forever: 200 },
    ])
    const extras = getExtraGamesForUser(STEAM_ID)
    expect(extras.map((e) => e.appid)).toEqual([2, 3, 1])
  })

  it("re-running updates playtime and preserves first_played via COALESCE", async () => {
    await seedProfile()
    mockStoreAppDetails(() => ({}))
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    await persistExtraGames(STEAM_ID, [
      { appid: 111, playtime_forever: 100, first_playtime: 1000, last_playtime: 2000 },
    ])
    // Second run: new playtime, no first_playtime in response
    await persistExtraGames(STEAM_ID, [{ appid: 111, playtime_forever: 150, last_playtime: 3000 }])
    const extras = getExtraGamesForUser(STEAM_ID)
    expect(extras[0].playtime_forever).toBe(150)
    expect(extras[0].rtime_first_played).toBe(1000) // preserved
    expect(extras[0].rtime_last_played).toBe(3000) // updated
  })

  it("caches fetched names into the shared games table so subsequent queries don't hit the store API", async () => {
    const db = await seedProfile()
    let calls = 0
    mockStoreAppDetails((appids) => {
      calls++
      const ids = appids.split(",").map(Number)
      const out: Record<string, unknown> = {}
      for (const id of ids) out[String(id)] = { success: true, data: { name: `Game ${id}`, type: "game" } }
      return out
    })
    const { persistExtraGames } = await import("@/lib/server/extra-games")
    await persistExtraGames(STEAM_ID, [{ appid: 111, playtime_forever: 500 }])
    expect(calls).toBe(1)

    // Second run with the same appid: name already cached → no new fetch
    await persistExtraGames(STEAM_ID, [{ appid: 111, playtime_forever: 600 }])
    expect(calls).toBe(1)

    const game = db.prepare("SELECT name FROM games WHERE appid = 111").get() as { name: string }
    expect(game.name).toBe("Game 111")
  })

  it("handles store API failures gracefully, leaving the row present without a name", async () => {
    const db = await seedProfile()
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    await persistExtraGames(STEAM_ID, [{ appid: 111, playtime_forever: 500 }])
    const extras = getExtraGamesForUser(STEAM_ID)
    expect(extras).toHaveLength(1)
    expect(extras[0].appid).toBe(111)
    // Nameless because the store API was down
    expect(extras[0].name).toBeNull()
    void db
  })

  it("handles store API rejected promises without breaking the sync", async () => {
    await seedProfile()
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network")
    }) as unknown as typeof fetch
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    await expect(persistExtraGames(STEAM_ID, [{ appid: 111, playtime_forever: 500 }])).resolves.toBeUndefined()
    expect(getExtraGamesForUser(STEAM_ID)).toHaveLength(1)
  })

  it("treats store API entries with success=false as nameless", async () => {
    await seedProfile()
    mockStoreAppDetails((appids) => {
      const out: Record<string, unknown> = {}
      for (const id of appids.split(",")) out[id] = { success: false }
      return out
    })
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    await persistExtraGames(STEAM_ID, [{ appid: 111, playtime_forever: 500 }])
    const extras = getExtraGamesForUser(STEAM_ID)
    expect(extras[0].name).toBeNull()
  })

  it("also skips pinned-resolved games (which land in user_games with owned=1)", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    // Simulate a pinned-resolved row: FaceRig upserted by ensurePinnedGamesSynced
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (274920, 'FaceRig', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
       VALUES (?, 274920, 569, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)
    mockStoreAppDetails(() => ({}))

    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    await persistExtraGames(STEAM_ID, [{ appid: 274920, playtime_forever: 569 }])
    expect(getExtraGamesForUser(STEAM_ID)).toEqual([])
  })
})

describe("getExtraGamesForUser", () => {
  it("returns [] for a user with no extras", async () => {
    await seedProfile()
    const { getExtraGamesForUser } = await import("@/lib/server/extra-games")
    expect(getExtraGamesForUser(STEAM_ID)).toEqual([])
  })
})
