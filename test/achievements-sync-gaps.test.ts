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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-ach-gaps-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198023709299"
const APPID = 620

async function seedProfileAndGame() {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(STEAM_ID, now, now)
  db.prepare(
    `INSERT INTO games (appid, name, has_community_visible_stats, created_at, updated_at)
              VALUES (?, ?, 1, ?, ?)`,
  ).run(APPID, "Portal 2", now, now)
  db.prepare(
    `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
              VALUES (?, ?, 100, 1, ?, ?)`,
  ).run(STEAM_ID, APPID, now, now)
  // Keep pinned empty to avoid contaminating fetch counts
  db.prepare("DELETE FROM pinned_games").run()
  // Mark owned-games sync as fresh so ensureOwnedGamesSynced is a no-op
  db.prepare("UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?").run(now, STEAM_ID)
  return db
}

function mockSteamApi(mocks: {
  getPlayerAchievements?: ReturnType<typeof vi.fn>
  getGameSchema?: ReturnType<typeof vi.fn>
}) {
  vi.doMock("@/lib/steam-api", () => ({
    getOwnedGames: vi.fn().mockResolvedValue([]),
    getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
    getPlayerAchievements: mocks.getPlayerAchievements ?? vi.fn().mockResolvedValue(null),
    getGameSchema: mocks.getGameSchema ?? vi.fn().mockResolvedValue(null),
    getLastPlayedTimes: vi.fn().mockResolvedValue([]),
  }))
  vi.doMock("@/lib/server/steam-images", () => ({
    ensureGameImages: vi.fn().mockResolvedValue(undefined),
  }))
}

describe("ensureSchema", () => {
  it("fetches and persists when no schema_synced_at is set", async () => {
    const getSchema = vi.fn().mockResolvedValue({
      availableGameStats: {
        achievements: [
          { name: "ACH_ONE", displayName: "One", description: "The first", icon: "icon.jpg", icongray: "icon_bw.jpg" },
          { name: "ACH_TWO", displayName: "Two", description: "The second" },
        ],
      },
    })
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()

    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await ensureSchema(APPID)

    expect(getSchema).toHaveBeenCalledWith(APPID)
    const rows = db
      .prepare("SELECT apiname, display_name FROM game_achievements WHERE appid = ? ORDER BY apiname")
      .all(APPID) as Array<{ apiname: string; display_name: string }>
    expect(rows).toHaveLength(2)
    expect(rows[0]?.apiname).toBe("ACH_ONE")
  })

  it("is a no-op when the schema is fresh and not forced", async () => {
    const getSchema = vi.fn()
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()
    const now = new Date().toISOString()
    db.prepare("UPDATE games SET schema_synced_at = ? WHERE appid = ?").run(now, APPID)

    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await ensureSchema(APPID)
    expect(getSchema).not.toHaveBeenCalled()
  })

  it("re-fetches on forceRefresh even when fresh", async () => {
    const getSchema = vi.fn().mockResolvedValue(null)
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()
    const now = new Date().toISOString()
    db.prepare("UPDATE games SET schema_synced_at = ? WHERE appid = ?").run(now, APPID)

    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await ensureSchema(APPID, { forceRefresh: true })
    expect(getSchema).toHaveBeenCalled()
  })

  it("handles a null schema response without crashing", async () => {
    const getSchema = vi.fn().mockResolvedValue(null)
    mockSteamApi({ getGameSchema: getSchema })
    await seedProfileAndGame()
    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await expect(ensureSchema(APPID)).resolves.toBeUndefined()
  })

  it("skips achievements with an empty name", async () => {
    const getSchema = vi.fn().mockResolvedValue({
      availableGameStats: {
        achievements: [{ name: "" }, { name: "OK", displayName: "Ok" }],
      },
    })
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()
    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await ensureSchema(APPID)
    const rows = db.prepare("SELECT apiname FROM game_achievements WHERE appid = ?").all(APPID) as Array<{
      apiname: string
    }>
    expect(rows.map((r) => r.apiname)).toEqual(["OK"])
  })
})

describe("getAchievementsForGame", () => {
  it("returns null when the user doesn't own the game", async () => {
    mockSteamApi({})
    await seedProfileAndGame()
    const { getAchievementsForGame } = await import("@/lib/server/steam-achievements-sync")
    expect(await getAchievementsForGame(STEAM_ID, 999999)).toBeNull()
  })

  it("returns null for a known-broken game (total_count=0) without hitting Steam", async () => {
    const getPlayerAchievements = vi.fn()
    mockSteamApi({ getPlayerAchievements })
    const db = await seedProfileAndGame()
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE user_games SET achievements_synced_at = ?, total_count = 0, unlocked_count = 0 WHERE steam_id = ? AND appid = ?`,
    ).run(now, STEAM_ID, APPID)

    const { getAchievementsForGame } = await import("@/lib/server/steam-achievements-sync")
    expect(await getAchievementsForGame(STEAM_ID, APPID)).toBeNull()
    expect(getPlayerAchievements).not.toHaveBeenCalled()
  })

  it("returns cached data for a fresh game without hitting Steam", async () => {
    const getPlayerAchievements = vi.fn()
    mockSteamApi({ getPlayerAchievements })
    const db = await seedProfileAndGame()
    const now = new Date().toISOString()

    // Seed game_achievements + user_achievements + meta so readStoredAchievementsList returns something
    db.prepare(
      `INSERT INTO game_achievements (appid, apiname, display_name, description, icon, icon_gray, hidden, created_at, updated_at)
       VALUES (?, 'ACH_ONE', 'One', 'First', 'icon.jpg', 'icon_bw.jpg', 0, ?, ?)`,
    ).run(APPID, now, now)
    db.prepare(
      `INSERT INTO user_achievements (steam_id, appid, apiname, achieved, unlock_time, created_at, updated_at)
       VALUES (?, ?, 'ACH_ONE', 1, 1700000000, ?, ?)`,
    ).run(STEAM_ID, APPID, now, now)
    db.prepare(
      `UPDATE user_games SET achievements_synced_at = ?, total_count = 1, unlocked_count = 1 WHERE steam_id = ? AND appid = ?`,
    ).run(now, STEAM_ID, APPID)

    const { getAchievementsForGame } = await import("@/lib/server/steam-achievements-sync")
    const result = await getAchievementsForGame(STEAM_ID, APPID)
    expect(result).not.toBeNull()
    expect(result?.achievements).toHaveLength(1)
    expect(getPlayerAchievements).not.toHaveBeenCalled()
  })

  it("fetches fresh data and persists on forceRefresh, then reads back the enriched list", async () => {
    const getPlayerAchievements = vi.fn().mockResolvedValue({
      steamID: STEAM_ID,
      gameName: "Portal 2",
      success: true,
      achievements: [{ apiname: "ACH_ONE", achieved: 1, unlocktime: 1_700_000_000 }],
    })
    const getGameSchema = vi.fn().mockResolvedValue({
      availableGameStats: {
        achievements: [
          { name: "ACH_ONE", displayName: "One", description: "First", icon: "i.jpg", icongray: "i_bw.jpg" },
        ],
      },
    })
    mockSteamApi({ getPlayerAchievements, getGameSchema })
    await seedProfileAndGame()

    const { getAchievementsForGame } = await import("@/lib/server/steam-achievements-sync")
    const result = await getAchievementsForGame(STEAM_ID, APPID, { forceRefresh: true })
    expect(result).not.toBeNull()
    expect(result?.gameName).toBe("Portal 2")
    expect(result?.achievements).toHaveLength(1)
    expect(result?.achievements[0]?.displayName).toBe("One")
  })

  it("marks the game as broken when Steam returns null", async () => {
    const getPlayerAchievements = vi.fn().mockResolvedValue(null)
    const getGameSchema = vi.fn().mockResolvedValue(null)
    mockSteamApi({ getPlayerAchievements, getGameSchema })
    const db = await seedProfileAndGame()

    const { getAchievementsForGame } = await import("@/lib/server/steam-achievements-sync")
    expect(await getAchievementsForGame(STEAM_ID, APPID)).toBeNull()

    const row = db
      .prepare(
        "SELECT total_count, unlocked_count, achievements_synced_at FROM user_games WHERE steam_id = ? AND appid = ?",
      )
      .get(STEAM_ID, APPID) as { total_count: number; unlocked_count: number; achievements_synced_at: string | null }
    expect(row.total_count).toBe(0)
    expect(row.achievements_synced_at).not.toBeNull()
  })

  it("falls through to fetch when cached data exists but game_achievements is empty", async () => {
    // Edge case: stored metadata says total_count > 0 but the schema/user rows
    // are missing, so readStoredAchievementsList returns null and the function
    // must fall through to the live fetch.
    const getPlayerAchievements = vi.fn().mockResolvedValue({
      steamID: STEAM_ID,
      gameName: "Portal 2",
      success: true,
      achievements: [{ apiname: "ACH_ONE", achieved: 1, unlocktime: 1 }],
    })
    mockSteamApi({ getPlayerAchievements })
    const db = await seedProfileAndGame()
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE user_games SET achievements_synced_at = ?, total_count = 1 WHERE steam_id = ? AND appid = ?`,
    ).run(now, STEAM_ID, APPID)

    const { getAchievementsForGame } = await import("@/lib/server/steam-achievements-sync")
    const result = await getAchievementsForGame(STEAM_ID, APPID)
    expect(getPlayerAchievements).toHaveBeenCalled()
    expect(result?.gameName).toBe("Portal 2")
  })
})
