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

const { invalidateStatsCache } = vi.hoisted(() => ({ invalidateStatsCache: vi.fn() }))
vi.mock("@/lib/steam-stats", () => ({ invalidateStatsCache }))

let tmpDir: string
const STEAM_ID = "76561198023709299"

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-manual-ownership-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
  invalidateStatsCache.mockClear()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

function mockSteamApi(playerAchievements: unknown = null) {
  vi.doMock("@/lib/steam-api", () => ({
    getOwnedGames: vi.fn().mockResolvedValue([]),
    getPlayerAchievements: vi.fn().mockResolvedValue(playerAchievements),
    getGameSchema: vi.fn().mockResolvedValue(null),
    getGlobalAchievementPercentages: vi.fn().mockResolvedValue(null),
    getLastPlayedTimes: vi.fn().mockResolvedValue([]),
  }))
}

async function seedExtra(appId: number, name: string | null) {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()
  db.prepare(`INSERT OR IGNORE INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(
    STEAM_ID,
    now,
    now,
  )
  if (name !== null) {
    db.prepare(`INSERT OR IGNORE INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
      appId,
      name,
      now,
      now,
    )
  }
  db.prepare(
    `INSERT INTO extra_games (steam_id, appid, playtime_forever, rtime_first_played, rtime_last_played,
       achievements_synced_at, unlocked_count, total_count, synced_at, created_at, updated_at)
     VALUES (?, ?, 321, 1000, 2000, ?, 1, 3, ?, ?, ?)`,
  ).run(STEAM_ID, appId, now, now, now, now)
  db.prepare(
    `INSERT INTO extra_game_achievements (steam_id, appid, apiname, achieved, unlock_time, created_at, updated_at)
     VALUES (?, ?, 'A', 1, 5, ?, ?)`,
  ).run(STEAM_ID, appId, now, now)
  return db
}

describe("promoteExtraToLibrary", () => {
  it("moves the extra into user_games as manual, drops the extras rows and syncs achievements", async () => {
    mockSteamApi({
      steamID: STEAM_ID,
      gameName: "Promoted",
      success: true,
      achievements: [
        { apiname: "A", achieved: 1, unlocktime: 5 },
        { apiname: "B", achieved: 0 },
      ],
    })
    const db = await seedExtra(111, "Promoted")
    const { promoteExtraToLibrary } = await import("@/lib/server/manual-ownership")

    const game = await promoteExtraToLibrary(STEAM_ID, 111)

    expect(game).toMatchObject({ appid: 111, name: "Promoted", playtime_forever: 321, ownedSource: "manual" })
    const ug = db
      .prepare(
        "SELECT owned, owned_source, playtime_forever, rtime_first_played, rtime_last_played FROM user_games WHERE steam_id = ? AND appid = 111",
      )
      .get(STEAM_ID) as Record<string, unknown>
    expect(ug).toEqual({
      owned: 1,
      owned_source: "manual",
      playtime_forever: 321,
      rtime_first_played: 1000,
      rtime_last_played: 2000,
    })
    expect(db.prepare("SELECT COUNT(*) AS c FROM extra_games WHERE appid = 111").get()).toEqual({ c: 0 })
    expect(db.prepare("SELECT COUNT(*) AS c FROM extra_game_achievements WHERE appid = 111").get()).toEqual({ c: 0 })
    const counts = db.prepare("SELECT unlocked_count, total_count FROM user_games WHERE appid = 111").get()
    expect(counts).toEqual({ unlocked_count: 1, total_count: 2 })
    expect(invalidateStatsCache).toHaveBeenCalledWith(STEAM_ID)
  })

  it("creates the games row for a nameless extra", async () => {
    mockSteamApi(null)
    const db = await seedExtra(222, null)
    const { promoteExtraToLibrary } = await import("@/lib/server/manual-ownership")
    const game = await promoteExtraToLibrary(STEAM_ID, 222)
    expect(game?.appid).toBe(222)
    expect(db.prepare("SELECT name FROM games WHERE appid = 222").get()).toEqual({ name: "" })
  })

  it("returns null for an app that is not one of the user's extras", async () => {
    mockSteamApi(null)
    await seedExtra(111, "X")
    const { promoteExtraToLibrary } = await import("@/lib/server/manual-ownership")
    expect(await promoteExtraToLibrary(STEAM_ID, 999)).toBeNull()
  })

  it("still promotes when the achievements sync fails", async () => {
    vi.doMock("@/lib/steam-api", () => ({
      getOwnedGames: vi.fn(),
      getPlayerAchievements: vi.fn().mockRejectedValue(new Error("steam down")),
      getGameSchema: vi.fn().mockRejectedValue(new Error("steam down")),
      getGlobalAchievementPercentages: vi.fn().mockResolvedValue(null),
      getLastPlayedTimes: vi.fn(),
    }))
    const db = await seedExtra(111, "Flaky")
    const { promoteExtraToLibrary } = await import("@/lib/server/manual-ownership")
    const game = await promoteExtraToLibrary(STEAM_ID, 111)
    expect(game?.ownedSource).toBe("manual")
    expect(db.prepare("SELECT owned FROM user_games WHERE appid = 111").get()).toEqual({ owned: 1 })
  })
})

describe("demoteManualGame", () => {
  it("flips a manual row back to owned=0/auto and re-creates the extra with its playtime", async () => {
    mockSteamApi(null)
    const db = await seedExtra(111, "Back")
    const { promoteExtraToLibrary, demoteManualGame } = await import("@/lib/server/manual-ownership")
    await promoteExtraToLibrary(STEAM_ID, 111)
    invalidateStatsCache.mockClear()

    expect(demoteManualGame(STEAM_ID, 111)).toBe(true)

    expect(db.prepare("SELECT owned, owned_source FROM user_games WHERE appid = 111").get()).toEqual({
      owned: 0,
      owned_source: "auto",
    })
    const extra = db
      .prepare("SELECT playtime_forever, rtime_first_played, rtime_last_played FROM extra_games WHERE appid = 111")
      .get()
    expect(extra).toEqual({ playtime_forever: 321, rtime_first_played: 1000, rtime_last_played: 2000 })
    expect(invalidateStatsCache).toHaveBeenCalledWith(STEAM_ID)
  })

  it("refuses to demote a game Steam reports as owned", async () => {
    mockSteamApi(null)
    const db = await seedExtra(111, "Owned")
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, owned_source, created_at, updated_at)
       VALUES (?, 620, 10, 1, 'auto', ?, ?)`,
    ).run(STEAM_ID, now, now)
    const { demoteManualGame } = await import("@/lib/server/manual-ownership")
    expect(demoteManualGame(STEAM_ID, 620)).toBe(false)
    expect(demoteManualGame(STEAM_ID, 999)).toBe(false)
    expect(db.prepare("SELECT owned FROM user_games WHERE appid = 620").get()).toEqual({ owned: 1 })
  })
})
