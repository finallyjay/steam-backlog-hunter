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

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-ach-test-"))
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
    "Test Game",
    now,
    now,
  )
  db.prepare(
    `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
     VALUES (?, ?, 0, 1, ?, ?)`,
  ).run(STEAM_ID, APPID, now, now)
  return db
}

describe("achievements dual-write (PR #1)", () => {
  it("creates game_achievements and user_achievements tables via migration", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
      name: string
    }>
    const names = tables.map((t) => t.name)

    expect(names).toContain("game_achievements")
    expect(names).toContain("user_achievements")
  })

  it("persistSchema writes to both schema_json and game_achievements", async () => {
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue({
        availableGameStats: {
          achievements: [
            {
              name: "ACH_WIN_ONE_GAME",
              displayName: "Win one game",
              description: "Win your first game",
              icon: "icon.jpg",
              icongray: "icongray.jpg",
              hidden: 0,
            },
            {
              name: "ACH_SECRET",
              displayName: "Secret",
              hidden: 1,
            },
          ],
        },
      }),
      getPlayerAchievements: vi.fn(),
      getOwnedGames: vi.fn().mockResolvedValue([]),
    }))

    const db = await seedProfileAndGame()
    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")

    await ensureSchema(STEAM_ID, APPID, { forceRefresh: true })

    const schemaRow = db.prepare("SELECT schema_json FROM games WHERE appid = ?").get(APPID) as {
      schema_json: string | null
    }
    expect(schemaRow.schema_json).toBeTruthy()

    const rows = db
      .prepare(
        "SELECT apiname, display_name, description, icon, icon_gray, hidden FROM game_achievements WHERE appid = ? ORDER BY apiname",
      )
      .all(APPID) as Array<{
      apiname: string
      display_name: string | null
      description: string | null
      icon: string | null
      icon_gray: string | null
      hidden: number
    }>

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      apiname: "ACH_SECRET",
      display_name: "Secret",
      hidden: 1,
    })
    expect(rows[1]).toMatchObject({
      apiname: "ACH_WIN_ONE_GAME",
      display_name: "Win one game",
      description: "Win your first game",
      icon: "icon.jpg",
      icon_gray: "icongray.jpg",
      hidden: 0,
    })
  })

  it("persistAchievements writes to both achievements_json and user_achievements", async () => {
    const db = await seedProfileAndGame()
    const { persistAchievements } = await import("@/lib/server/steam-achievements-sync")

    persistAchievements(STEAM_ID, APPID, [
      {
        apiname: "ACH_WIN_ONE_GAME",
        achieved: 1,
        unlocktime: 1_700_000_000,
        displayName: "Win one game",
        description: "",
        icon: "",
        icongray: "",
      },
      {
        apiname: "ACH_KILL_100",
        achieved: 0,
        unlocktime: 0,
        displayName: "Kill 100 enemies",
        description: "",
        icon: "",
        icongray: "",
      },
    ])

    const userGameRow = db
      .prepare(
        "SELECT achievements_json, unlocked_count, total_count, perfect_game FROM user_games WHERE steam_id = ? AND appid = ?",
      )
      .get(STEAM_ID, APPID) as {
      achievements_json: string
      unlocked_count: number
      total_count: number
      perfect_game: number
    }
    expect(userGameRow.unlocked_count).toBe(1)
    expect(userGameRow.total_count).toBe(2)
    expect(userGameRow.perfect_game).toBe(0)
    expect(JSON.parse(userGameRow.achievements_json)).toHaveLength(2)

    const normalized = db
      .prepare(
        "SELECT apiname, achieved, unlock_time FROM user_achievements WHERE steam_id = ? AND appid = ? ORDER BY apiname",
      )
      .all(STEAM_ID, APPID) as Array<{ apiname: string; achieved: number; unlock_time: number | null }>

    expect(normalized).toEqual([
      { apiname: "ACH_KILL_100", achieved: 0, unlock_time: 0 },
      { apiname: "ACH_WIN_ONE_GAME", achieved: 1, unlock_time: 1_700_000_000 },
    ])
  })

  it("migration 8 backfills normalized tables from legacy JSON blobs on upgrade", async () => {
    // Phase 1: initialise a fully-migrated DB, seed legacy blobs, then revert
    // to a pre-migration-8 state (drop normalized tables + unapply migration 8)
    // so we can observe the upgrade path run on re-open.
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const seedDb = getSqliteDatabase()
    const now = new Date().toISOString()

    seedDb
      .prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`)
      .run(STEAM_ID, now, now)

    const legacySchema = {
      availableGameStats: {
        achievements: [
          {
            name: "ACH_LEGACY_ONE",
            displayName: "Legacy One",
            description: "Unlocked legacy achievement",
            icon: "legacy-one.jpg",
            icongray: "legacy-one-gray.jpg",
            hidden: 0,
          },
          {
            name: "ACH_LEGACY_TWO",
            displayName: "Legacy Two",
            description: "Still-locked legacy achievement",
            icon: "legacy-two.jpg",
            icongray: "legacy-two-gray.jpg",
            hidden: 1,
          },
        ],
      },
    }

    seedDb
      .prepare(
        `INSERT INTO games (appid, name, schema_json, schema_synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(APPID, "Legacy Game", JSON.stringify(legacySchema), now, now, now)

    const legacyUserAchievements = [
      {
        apiname: "ACH_LEGACY_ONE",
        achieved: 1,
        unlocktime: 1_650_000_000,
        displayName: "Legacy One",
        description: "",
        icon: "",
        icongray: "",
      },
      {
        apiname: "ACH_LEGACY_TWO",
        achieved: 0,
        unlocktime: 0,
        displayName: "Legacy Two",
        description: "",
        icon: "",
        icongray: "",
      },
    ]

    seedDb
      .prepare(
        `INSERT INTO user_games (
          steam_id, appid, playtime_forever, owned, achievements_json,
          achievements_synced_at, unlocked_count, total_count, perfect_game,
          created_at, updated_at
        ) VALUES (?, ?, 0, 1, ?, ?, 1, 2, 0, ?, ?)`,
      )
      .run(STEAM_ID, APPID, JSON.stringify(legacyUserAchievements), now, now, now)

    // Revert to pre-migration-8 state: drop normalized tables + unapply v8.
    // Also wipe any rows the dual-write path wrote into the normalized tables
    // during seeding — we want to verify the backfill alone reconstructs them.
    seedDb.exec(`
      DROP TABLE IF EXISTS game_achievements;
      DROP TABLE IF EXISTS user_achievements;
      DELETE FROM schema_migrations WHERE version = 8;
    `)

    // Close this handle so the re-import gets a fresh DatabaseSync to the
    // same file and triggers migration 8.
    seedDb.close()

    vi.resetModules()
    const { getSqliteDatabase: getFreshDb } = await import("@/lib/server/sqlite")
    const db = getFreshDb()

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
      name: string
    }>
    const names = tables.map((t) => t.name)
    expect(names).toContain("game_achievements")
    expect(names).toContain("user_achievements")

    const gameAchRows = db
      .prepare(
        "SELECT apiname, display_name, description, icon, icon_gray, hidden FROM game_achievements WHERE appid = ? ORDER BY apiname",
      )
      .all(APPID) as Array<{
      apiname: string
      display_name: string | null
      description: string | null
      icon: string | null
      icon_gray: string | null
      hidden: number
    }>

    expect(gameAchRows).toEqual([
      {
        apiname: "ACH_LEGACY_ONE",
        display_name: "Legacy One",
        description: "Unlocked legacy achievement",
        icon: "legacy-one.jpg",
        icon_gray: "legacy-one-gray.jpg",
        hidden: 0,
      },
      {
        apiname: "ACH_LEGACY_TWO",
        display_name: "Legacy Two",
        description: "Still-locked legacy achievement",
        icon: "legacy-two.jpg",
        icon_gray: "legacy-two-gray.jpg",
        hidden: 1,
      },
    ])

    const userAchRows = db
      .prepare(
        "SELECT apiname, achieved, unlock_time FROM user_achievements WHERE steam_id = ? AND appid = ? ORDER BY apiname",
      )
      .all(STEAM_ID, APPID) as Array<{ apiname: string; achieved: number; unlock_time: number | null }>

    expect(userAchRows).toEqual([
      { apiname: "ACH_LEGACY_ONE", achieved: 1, unlock_time: 1_650_000_000 },
      { apiname: "ACH_LEGACY_TWO", achieved: 0, unlock_time: 0 },
    ])
  })

  it("persistAchievements is idempotent — re-running replaces normalized rows", async () => {
    const db = await seedProfileAndGame()
    const { persistAchievements } = await import("@/lib/server/steam-achievements-sync")

    persistAchievements(STEAM_ID, APPID, [
      { apiname: "A", achieved: 0, unlocktime: 0, displayName: "", description: "", icon: "", icongray: "" },
      { apiname: "B", achieved: 0, unlocktime: 0, displayName: "", description: "", icon: "", icongray: "" },
    ])
    persistAchievements(STEAM_ID, APPID, [
      { apiname: "A", achieved: 1, unlocktime: 123, displayName: "", description: "", icon: "", icongray: "" },
    ])

    const rows = db
      .prepare("SELECT apiname, achieved FROM user_achievements WHERE steam_id = ? AND appid = ?")
      .all(STEAM_ID, APPID) as Array<{ apiname: string; achieved: number }>

    expect(rows).toEqual([{ apiname: "A", achieved: 1 }])
  })
})
