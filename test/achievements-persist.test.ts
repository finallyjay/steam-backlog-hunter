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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-persist-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198000000001"
const APPID = 730

async function seedProfileAndGame() {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()

  db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(STEAM_ID, now, now)
  db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
    APPID,
    "Counter-Strike 2",
    now,
    now,
  )
  db.prepare(
    `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
     VALUES (?, ?, 0, 1, ?, ?)`,
  ).run(STEAM_ID, APPID, now, now)

  return db
}

describe("schema is the clean target shape (no JSON blob columns)", () => {
  it("user_games has no achievements_json column", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const cols = db.prepare(`PRAGMA table_info(user_games)`).all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).not.toContain("achievements_json")
  })

  it("games has no schema_json column", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const cols = db.prepare(`PRAGMA table_info(games)`).all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).not.toContain("schema_json")
  })
})

describe("persistAchievements (post-cleanup)", () => {
  it("writes metadata and only inserts rows for unlocked achievements", async () => {
    const db = await seedProfileAndGame()
    const { persistAchievements } = await import("@/lib/server/steam-achievements-sync")

    persistAchievements(STEAM_ID, APPID, [
      { apiname: "ACH_ONE", achieved: 1, unlocktime: 1_700_000_000 },
      { apiname: "ACH_TWO", achieved: 0, unlocktime: 0 },
      { apiname: "ACH_THREE", achieved: 1, unlocktime: 1_700_000_500 },
    ])

    const meta = db
      .prepare("SELECT unlocked_count, total_count, perfect_game FROM user_games WHERE steam_id = ? AND appid = ?")
      .get(STEAM_ID, APPID) as { unlocked_count: number; total_count: number; perfect_game: number }
    expect(meta).toEqual({ unlocked_count: 2, total_count: 3, perfect_game: 0 })

    const rows = db
      .prepare(
        "SELECT apiname, achieved, unlock_time FROM user_achievements WHERE steam_id = ? AND appid = ? ORDER BY apiname",
      )
      .all(STEAM_ID, APPID) as Array<{ apiname: string; achieved: number; unlock_time: number | null }>

    expect(rows).toEqual([
      { apiname: "ACH_ONE", achieved: 1, unlock_time: 1_700_000_000 },
      { apiname: "ACH_THREE", achieved: 1, unlock_time: 1_700_000_500 },
    ])
  })

  it("flags perfect_game when every achievement is unlocked", async () => {
    const db = await seedProfileAndGame()
    const { persistAchievements } = await import("@/lib/server/steam-achievements-sync")

    persistAchievements(STEAM_ID, APPID, [
      { apiname: "A", achieved: 1, unlocktime: 1 },
      { apiname: "B", achieved: 1, unlocktime: 2 },
    ])

    const meta = db
      .prepare("SELECT unlocked_count, total_count, perfect_game FROM user_games WHERE appid = ?")
      .get(APPID) as { unlocked_count: number; total_count: number; perfect_game: number }
    expect(meta).toEqual({ unlocked_count: 2, total_count: 2, perfect_game: 1 })
  })

  it("replaces existing user_achievements rows on re-persist", async () => {
    const db = await seedProfileAndGame()
    const { persistAchievements } = await import("@/lib/server/steam-achievements-sync")

    persistAchievements(STEAM_ID, APPID, [
      { apiname: "A", achieved: 1, unlocktime: 1 },
      { apiname: "B", achieved: 1, unlocktime: 2 },
    ])
    persistAchievements(STEAM_ID, APPID, [{ apiname: "A", achieved: 1, unlocktime: 1 }])

    const rows = db
      .prepare("SELECT apiname FROM user_achievements WHERE steam_id = ? AND appid = ? ORDER BY apiname")
      .all(STEAM_ID, APPID) as Array<{ apiname: string }>
    expect(rows).toEqual([{ apiname: "A" }])
  })

  it("dedupes duplicate apinames within a single persist call", async () => {
    const db = await seedProfileAndGame()
    const { persistAchievements } = await import("@/lib/server/steam-achievements-sync")

    persistAchievements(STEAM_ID, APPID, [
      { apiname: "ACH_ONE", achieved: 1, unlocktime: 1_700_000_000 },
      { apiname: "ACH_ONE", achieved: 1, unlocktime: 1_700_000_500 },
      { apiname: "ACH_TWO", achieved: 1, unlocktime: 1_700_000_600 },
    ])

    const rows = db
      .prepare("SELECT apiname FROM user_achievements WHERE steam_id = ? AND appid = ? ORDER BY apiname")
      .all(STEAM_ID, APPID) as Array<{ apiname: string }>
    expect(rows).toEqual([{ apiname: "ACH_ONE" }, { apiname: "ACH_TWO" }])

    const meta = db.prepare("SELECT unlocked_count FROM user_games WHERE appid = ?").get(APPID) as {
      unlocked_count: number
    }
    expect(meta.unlocked_count).toBe(2)
  })

  it("empty array marks game as broken/retired (total_count=0, synced_at set)", async () => {
    const db = await seedProfileAndGame()
    const { persistAchievements } = await import("@/lib/server/steam-achievements-sync")

    persistAchievements(STEAM_ID, APPID, [])

    const meta = db
      .prepare(
        "SELECT unlocked_count, total_count, perfect_game, achievements_synced_at FROM user_games WHERE appid = ?",
      )
      .get(APPID) as {
      unlocked_count: number
      total_count: number
      perfect_game: number
      achievements_synced_at: string | null
    }
    expect(meta.unlocked_count).toBe(0)
    expect(meta.total_count).toBe(0)
    expect(meta.perfect_game).toBe(0)
    expect(meta.achievements_synced_at).toBeTruthy()
  })
})
