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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-last-played-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  process.env.STEAM_API_KEY = "fake-key"
  vi.resetModules()
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  delete process.env.SQLITE_PATH
  delete process.env.STEAM_API_KEY
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198023709299"

describe("getLastPlayedTimes (Steam API wrapper)", () => {
  it("returns the games array on success", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        response: {
          games: [
            { appid: 274920, playtime_forever: 569, first_playtime: 1415148326, last_playtime: 1748176523 },
            { appid: 620, playtime_forever: 3000, first_playtime: 1300000000, last_playtime: 1700000000 },
          ],
        },
      }),
    })) as unknown as typeof fetch
    const { getLastPlayedTimes } = await import("@/lib/steam-api")
    const games = await getLastPlayedTimes(STEAM_ID)
    expect(games).toHaveLength(2)
    expect(games[0].appid).toBe(274920)
    expect(games[0].playtime_forever).toBe(569)
  })

  it("passes steamid and min_last_played=0 as query parameters", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ response: { games: [] } }),
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const { getLastPlayedTimes } = await import("@/lib/steam-api")
    await getLastPlayedTimes(STEAM_ID)
    const calledWith = (fetchMock as unknown as { mock: { calls: [[string, unknown]] } }).mock.calls[0][0]
    expect(calledWith).toContain("ClientGetLastPlayedTimes")
    expect(calledWith).toContain(`steamid=${STEAM_ID}`)
    expect(calledWith).toContain("min_last_played=0")
  })

  it("returns [] silently on a 400 (account with nothing played)", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
    })) as unknown as typeof fetch
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { getLastPlayedTimes } = await import("@/lib/steam-api")
    expect(await getLastPlayedTimes(STEAM_ID)).toEqual([])
    expect(consoleSpy).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it("returns [] and logs on network failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNRESET")
    }) as unknown as typeof fetch
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { getLastPlayedTimes } = await import("@/lib/steam-api")
    expect(await getLastPlayedTimes(STEAM_ID)).toEqual([])
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe("persistLastPlayedTimes", () => {
  async function seed() {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(STEAM_ID, now, now)
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (274920, 'FaceRig', ?, ?)`).run(now, now)
    // Portal 2: already has some playtime and rtime_last_played
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, rtime_last_played, owned, created_at, updated_at)
       VALUES (?, 620, 100, 1600000000, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)
    // FaceRig: pinned, playtime=0 placeholder
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
       VALUES (?, 274920, 0, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)
    return db
  }

  it("enriches existing rows with playtime_forever, last_playtime and first_playtime", async () => {
    const db = await seed()
    const { persistLastPlayedTimes } = await import("@/lib/server/steam-games-sync")

    persistLastPlayedTimes(STEAM_ID, [
      { appid: 274920, playtime_forever: 569, first_playtime: 1415148326, last_playtime: 1748176523 },
      { appid: 620, playtime_forever: 3000, first_playtime: 1300000000, last_playtime: 1700000000 },
    ])

    const facerig = db
      .prepare("SELECT playtime_forever, rtime_first_played, rtime_last_played FROM user_games WHERE appid = 274920")
      .get() as { playtime_forever: number; rtime_first_played: number; rtime_last_played: number }
    expect(facerig.playtime_forever).toBe(569)
    expect(facerig.rtime_first_played).toBe(1415148326)
    expect(facerig.rtime_last_played).toBe(1748176523)

    const portal2 = db
      .prepare("SELECT playtime_forever, rtime_first_played, rtime_last_played FROM user_games WHERE appid = 620")
      .get() as { playtime_forever: number; rtime_first_played: number; rtime_last_played: number }
    expect(portal2.playtime_forever).toBe(3000)
    expect(portal2.rtime_first_played).toBe(1300000000)
    expect(portal2.rtime_last_played).toBe(1700000000)
  })

  it("ignores appids not present in user_games (no new rows created)", async () => {
    const db = await seed()
    const { persistLastPlayedTimes } = await import("@/lib/server/steam-games-sync")

    persistLastPlayedTimes(STEAM_ID, [{ appid: 999999, playtime_forever: 100, first_playtime: 1, last_playtime: 2 }])

    const row = db.prepare("SELECT 1 FROM user_games WHERE steam_id = ? AND appid = 999999").get(STEAM_ID)
    expect(row).toBeUndefined()
  })

  it("preserves the existing rtime_last_played when last_playtime is undefined", async () => {
    const db = await seed()
    const { persistLastPlayedTimes } = await import("@/lib/server/steam-games-sync")

    persistLastPlayedTimes(STEAM_ID, [{ appid: 620, playtime_forever: 200 }])

    const row = db.prepare("SELECT playtime_forever, rtime_last_played FROM user_games WHERE appid = 620").get() as {
      playtime_forever: number
      rtime_last_played: number
    }
    expect(row.playtime_forever).toBe(200)
    expect(row.rtime_last_played).toBe(1600000000) // unchanged
  })

  it("is a no-op when called with an empty list", async () => {
    const db = await seed()
    const { persistLastPlayedTimes } = await import("@/lib/server/steam-games-sync")
    persistLastPlayedTimes(STEAM_ID, [])
    const row = db.prepare("SELECT playtime_forever FROM user_games WHERE appid = 274920").get() as {
      playtime_forever: number
    }
    expect(row.playtime_forever).toBe(0) // unchanged
  })

  it("skips entries with undefined playtime_forever", async () => {
    const db = await seed()
    const { persistLastPlayedTimes } = await import("@/lib/server/steam-games-sync")
    persistLastPlayedTimes(STEAM_ID, [{ appid: 274920, first_playtime: 1415148326 }])
    const row = db.prepare("SELECT playtime_forever FROM user_games WHERE appid = 274920").get() as {
      playtime_forever: number
    }
    expect(row.playtime_forever).toBe(0) // unchanged because we skipped
  })
})
