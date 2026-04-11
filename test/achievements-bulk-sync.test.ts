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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-bulk-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198000000001"

async function seedOwnedGames(
  entries: Array<{ appid: number; name: string; hasStats?: boolean; syncedAt?: string | null; totalCount?: number }>,
) {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()

  db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(STEAM_ID, now, now)

  for (const entry of entries) {
    db.prepare(
      `INSERT INTO games (appid, name, has_community_visible_stats, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(entry.appid, entry.name, entry.hasStats === false ? 0 : 1, now, now)

    db.prepare(
      `INSERT INTO user_games (
        steam_id, appid, playtime_forever, owned, achievements_synced_at,
        unlocked_count, total_count, perfect_game, created_at, updated_at
      ) VALUES (?, ?, 0, 1, ?, 0, ?, 0, ?, ?)`,
    ).run(STEAM_ID, entry.appid, entry.syncedAt ?? null, entry.totalCount ?? 0, now, now)
  }

  return db
}

describe("persistBulkGameStats", () => {
  it("writes metadata and replaces user_achievements rows from a bulk response", async () => {
    const db = await seedOwnedGames([{ appid: 730, name: "CS2" }])
    const { persistBulkGameStats } = await import("@/lib/server/steam-achievements-sync")

    persistBulkGameStats(STEAM_ID, 730, 5, ["ACH_ONE", "ACH_TWO"])

    const meta = db
      .prepare(
        "SELECT unlocked_count, total_count, perfect_game, achievements_synced_at FROM user_games WHERE steam_id = ? AND appid = ?",
      )
      .get(STEAM_ID, 730) as {
      unlocked_count: number
      total_count: number
      perfect_game: number
      achievements_synced_at: string | null
    }

    expect(meta.unlocked_count).toBe(2)
    expect(meta.total_count).toBe(5)
    expect(meta.perfect_game).toBe(0)
    expect(meta.achievements_synced_at).toBeTruthy()

    const rows = db
      .prepare(
        "SELECT apiname, achieved, unlock_time FROM user_achievements WHERE steam_id = ? AND appid = ? ORDER BY apiname",
      )
      .all(STEAM_ID, 730) as Array<{ apiname: string; achieved: number; unlock_time: number | null }>

    expect(rows).toEqual([
      { apiname: "ACH_ONE", achieved: 1, unlock_time: null },
      { apiname: "ACH_TWO", achieved: 1, unlock_time: null },
    ])
  })

  it("flags perfect_game when unlocked === total", async () => {
    const db = await seedOwnedGames([{ appid: 440, name: "TF2" }])
    const { persistBulkGameStats } = await import("@/lib/server/steam-achievements-sync")

    persistBulkGameStats(STEAM_ID, 440, 3, ["A", "B", "C"])

    const meta = db
      .prepare("SELECT unlocked_count, total_count, perfect_game FROM user_games WHERE steam_id = ? AND appid = ?")
      .get(STEAM_ID, 440) as { unlocked_count: number; total_count: number; perfect_game: number }

    expect(meta).toEqual({ unlocked_count: 3, total_count: 3, perfect_game: 1 })
  })

  it("dedupes duplicate apinames returned by the bulk endpoint", async () => {
    const db = await seedOwnedGames([{ appid: 620, name: "Portal 2" }])
    const { persistBulkGameStats } = await import("@/lib/server/steam-achievements-sync")

    persistBulkGameStats(STEAM_ID, 620, 5, ["A", "B", "A", "C", "B"])

    const meta = db
      .prepare("SELECT unlocked_count, total_count FROM user_games WHERE steam_id = ? AND appid = ?")
      .get(STEAM_ID, 620) as { unlocked_count: number; total_count: number }
    expect(meta).toEqual({ unlocked_count: 3, total_count: 5 })

    const rows = db
      .prepare("SELECT apiname FROM user_achievements WHERE steam_id = ? AND appid = ? ORDER BY apiname")
      .all(STEAM_ID, 620) as Array<{ apiname: string }>
    expect(rows).toEqual([{ apiname: "A" }, { apiname: "B" }, { apiname: "C" }])
  })

  it("clears stale user_achievements when re-persisting with fewer unlocks", async () => {
    const db = await seedOwnedGames([{ appid: 570, name: "Dota 2" }])
    const { persistBulkGameStats } = await import("@/lib/server/steam-achievements-sync")

    persistBulkGameStats(STEAM_ID, 570, 4, ["A", "B", "C"])
    persistBulkGameStats(STEAM_ID, 570, 4, ["A"])

    const rows = db
      .prepare("SELECT apiname FROM user_achievements WHERE steam_id = ? AND appid = ?")
      .all(STEAM_ID, 570) as Array<{ apiname: string }>

    expect(rows).toEqual([{ apiname: "A" }])
  })
})

describe("syncAchievementsForStats (bulk endpoint)", () => {
  it("batches stale games through getTopAchievementsForGames and persists results", async () => {
    const mockGetTop = vi.fn().mockResolvedValue([
      { appid: 730, total_achievements: 2, achievements: [{ name: "ACH_ONE" }] },
      { appid: 440, total_achievements: 3, achievements: [{ name: "ACH_A" }, { name: "ACH_B" }, { name: "ACH_C" }] },
      { appid: 570, total_achievements: 0 },
    ])

    vi.doMock("@/lib/steam-api", () => ({
      getTopAchievementsForGames: mockGetTop,
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: vi.fn(),
      getGameSchema: vi.fn(),
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))

    const db = await seedOwnedGames([
      { appid: 730, name: "CS2" },
      { appid: 440, name: "TF2" },
      { appid: 570, name: "Dota 2" },
      // This one has no community stats — should be excluded from the bulk call
      { appid: 999, name: "No Stats Game", hasStats: false },
    ])

    // Mark owned-games sync as fresh so ensureOwnedGamesSynced is a no-op
    const now = new Date().toISOString()
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(now, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    // forceRefresh: false so ensureOwnedGamesSynced returns the seeded cache
    // instead of calling the mocked getOwnedGames (which would return []).
    // The stale filter still fires because achievements_synced_at is NULL.
    const stats = await getStatsForUser(STEAM_ID, { forceRefresh: false })

    expect(mockGetTop).toHaveBeenCalledTimes(1)
    expect(mockGetTop.mock.calls[0][0]).toBe(STEAM_ID)
    // The candidate list is filtered by has_community_visible_stats, so 999 is excluded.
    expect(new Set(mockGetTop.mock.calls[0][1])).toEqual(new Set([730, 440, 570]))

    const rows = db
      .prepare(
        "SELECT appid, unlocked_count, total_count, perfect_game FROM user_games WHERE steam_id = ? ORDER BY appid",
      )
      .all(STEAM_ID) as Array<{ appid: number; unlocked_count: number; total_count: number; perfect_game: number }>

    expect(rows).toEqual([
      { appid: 440, unlocked_count: 3, total_count: 3, perfect_game: 1 },
      { appid: 570, unlocked_count: 0, total_count: 0, perfect_game: 0 },
      { appid: 730, unlocked_count: 1, total_count: 2, perfect_game: 0 },
      { appid: 999, unlocked_count: 0, total_count: 0, perfect_game: 0 },
    ])

    expect(stats.totalAchievements).toBe(4) // 1 + 3 + 0
    expect(stats.perfectGames).toBe(1)
  })

  it("skips games that are already fresh and not forced", async () => {
    const mockGetTop = vi.fn().mockResolvedValue([])

    vi.doMock("@/lib/steam-api", () => ({
      getTopAchievementsForGames: mockGetTop,
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: vi.fn(),
      getGameSchema: vi.fn(),
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))

    const freshIso = new Date().toISOString()
    const db = await seedOwnedGames([{ appid: 730, name: "CS2", syncedAt: freshIso, totalCount: 5 }])
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(freshIso, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    // Force stats recompute but not forceRefresh at the achievements layer
    await getStatsForUser(STEAM_ID, { forceRefresh: false })
    // Stats snapshot is stale-by-default on first call, so it will run syncAchievementsForStats.
    // With the only candidate game fresh, the bulk call should NOT fire.
    expect(mockGetTop).not.toHaveBeenCalled()
  })

  it("continues sync when a bulk batch throws — affected games stay stale", async () => {
    const mockGetTop = vi.fn().mockRejectedValue(new Error("network blip"))

    vi.doMock("@/lib/steam-api", () => ({
      getTopAchievementsForGames: mockGetTop,
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: vi.fn(),
      getGameSchema: vi.fn(),
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))

    const db = await seedOwnedGames([{ appid: 730, name: "CS2" }])
    const now = new Date().toISOString()
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(now, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    await expect(getStatsForUser(STEAM_ID, { forceRefresh: false })).resolves.toBeTruthy()

    // Stale game remains unsynced (no achievements_synced_at written)
    const row = db
      .prepare("SELECT achievements_synced_at FROM user_games WHERE steam_id = ? AND appid = ?")
      .get(STEAM_ID, 730) as { achievements_synced_at: string | null }
    expect(row.achievements_synced_at).toBeNull()
  })
})
