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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-sync-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198000000001"

async function seedOwnedGames(
  entries: Array<{
    appid: number
    name: string
    hasStats?: boolean | null
    syncedAt?: string | null
    totalCount?: number
    rtimeLastPlayed?: number | null
  }>,
) {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()

  db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(STEAM_ID, now, now)

  for (const entry of entries) {
    const statsFlag = entry.hasStats === null ? null : entry.hasStats === false ? 0 : 1
    db.prepare(
      `INSERT INTO games (appid, name, has_community_visible_stats, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(entry.appid, entry.name, statsFlag, now, now)

    db.prepare(
      `INSERT INTO user_games (
        steam_id, appid, playtime_forever, rtime_last_played, owned, achievements_synced_at,
        unlocked_count, total_count, perfect_game, created_at, updated_at
      ) VALUES (?, ?, 0, ?, 1, ?, 0, ?, 0, ?, ?)`,
    ).run(STEAM_ID, entry.appid, entry.rtimeLastPlayed ?? null, entry.syncedAt ?? null, entry.totalCount ?? 0, now, now)
  }

  return db
}

describe("syncAchievementsForStats (per-game)", () => {
  it("syncs each stale game via GetPlayerAchievements and persists results", async () => {
    const mockGetPlayerAchievements = vi.fn(async (_steamId: string, appId: number) => {
      const achievements: Record<number, Array<{ apiname: string; achieved: number; unlocktime: number }>> = {
        730: [
          { apiname: "ACH_ONE", achieved: 1, unlocktime: 1_700_000_001 },
          { apiname: "ACH_TWO", achieved: 0, unlocktime: 0 },
        ],
        440: [
          { apiname: "ACH_A", achieved: 1, unlocktime: 1_700_000_100 },
          { apiname: "ACH_B", achieved: 1, unlocktime: 1_700_000_200 },
          { apiname: "ACH_C", achieved: 1, unlocktime: 1_700_000_300 },
        ],
        570: [],
      }
      return {
        steamID: STEAM_ID,
        gameName: `Game ${appId}`,
        achievements: achievements[appId] ?? [],
        success: true,
      }
    })
    const mockGetGameSchema = vi.fn().mockResolvedValue(null)

    vi.doMock("@/lib/steam-api", () => ({
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: mockGetPlayerAchievements,
      getGameSchema: mockGetGameSchema,
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))

    const db = await seedOwnedGames([
      { appid: 730, name: "CS2" },
      { appid: 440, name: "TF2" },
      { appid: 570, name: "Dota 2" },
      { appid: 999, name: "No Stats Game", hasStats: false },
    ])

    const now = new Date().toISOString()
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(now, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    const stats = await getStatsForUser(STEAM_ID, { forceRefresh: false })

    const calledAppIds = new Set(mockGetPlayerAchievements.mock.calls.map((c) => c[1]))
    expect(calledAppIds).toEqual(new Set([730, 440, 570]))
    expect(mockGetPlayerAchievements).not.toHaveBeenCalledWith(expect.anything(), 999)

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

    expect(stats.totalAchievements).toBe(4)
    expect(stats.perfectGames).toBe(1)
  })

  it("skips games that are already fresh and not forced", async () => {
    const mockGetPlayerAchievements = vi.fn()

    vi.doMock("@/lib/steam-api", () => ({
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: mockGetPlayerAchievements,
      getGameSchema: vi.fn(),
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))

    const freshIso = new Date().toISOString()
    const db = await seedOwnedGames([{ appid: 730, name: "CS2", syncedAt: freshIso, totalCount: 5 }])
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(freshIso, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    await getStatsForUser(STEAM_ID, { forceRefresh: false })

    expect(mockGetPlayerAchievements).not.toHaveBeenCalled()
  })

  it("continues when a single per-game request throws — other games still get synced", async () => {
    const mockGetPlayerAchievements = vi.fn(async (_steamId: string, appId: number) => {
      if (appId === 730) throw new Error("network blip")
      return {
        steamID: STEAM_ID,
        gameName: `Game ${appId}`,
        achievements: [{ apiname: "OK", achieved: 1, unlocktime: 1 }],
        success: true,
      }
    })

    vi.doMock("@/lib/steam-api", () => ({
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: mockGetPlayerAchievements,
      getGameSchema: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))

    const db = await seedOwnedGames([
      { appid: 730, name: "CS2" },
      { appid: 440, name: "TF2" },
    ])
    const now = new Date().toISOString()
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(now, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    await expect(getStatsForUser(STEAM_ID, { forceRefresh: false })).resolves.toBeTruthy()

    const failed = db
      .prepare("SELECT achievements_synced_at FROM user_games WHERE steam_id = ? AND appid = ?")
      .get(STEAM_ID, 730) as { achievements_synced_at: string | null }
    expect(failed.achievements_synced_at).toBeNull()

    const ok = db
      .prepare("SELECT achievements_synced_at, unlocked_count FROM user_games WHERE steam_id = ? AND appid = ?")
      .get(STEAM_ID, 440) as { achievements_synced_at: string | null; unlocked_count: number }
    expect(ok.achievements_synced_at).not.toBeNull()
    expect(ok.unlocked_count).toBe(1)
  })

  it("marks broken/retired games (null response) with total_count=0 so they stop retrying", async () => {
    const mockGetPlayerAchievements = vi.fn().mockResolvedValue(null)

    vi.doMock("@/lib/steam-api", () => ({
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: mockGetPlayerAchievements,
      getGameSchema: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))

    const db = await seedOwnedGames([{ appid: 730, name: "CS2" }])
    const now = new Date().toISOString()
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(now, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    await getStatsForUser(STEAM_ID, { forceRefresh: false })

    const row = db
      .prepare(
        "SELECT unlocked_count, total_count, achievements_synced_at FROM user_games WHERE steam_id = ? AND appid = ?",
      )
      .get(STEAM_ID, 730) as { unlocked_count: number; total_count: number; achievements_synced_at: string | null }
    expect(row.unlocked_count).toBe(0)
    expect(row.total_count).toBe(0)
    expect(row.achievements_synced_at).not.toBeNull()
  })
})

describe("syncAchievementsForStats (incremental filter)", () => {
  function mockSteamApi(mockGetPlayerAchievements: ReturnType<typeof vi.fn>) {
    vi.doMock("@/lib/steam-api", () => ({
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: mockGetPlayerAchievements,
      getGameSchema: vi.fn().mockResolvedValue(null),
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))
  }

  it("re-syncs a game whose rtime_last_played is newer than its achievements_synced_at", async () => {
    const mockGetPlayerAchievements = vi.fn().mockResolvedValue({
      steamID: STEAM_ID,
      gameName: "CS2",
      achievements: [{ apiname: "ACH_NEW", achieved: 1, unlocktime: 1_800_000_100 }],
      success: true,
    })
    mockSteamApi(mockGetPlayerAchievements)

    const syncedAtIso = new Date(1_800_000_000 * 1000).toISOString()
    const db = await seedOwnedGames([
      {
        appid: 730,
        name: "CS2",
        syncedAt: syncedAtIso,
        totalCount: 5,
        rtimeLastPlayed: 1_800_000_050, // played AFTER syncedAt
      },
    ])
    const now = new Date().toISOString()
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(now, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    await getStatsForUser(STEAM_ID, { forceRefresh: false })

    expect(mockGetPlayerAchievements).toHaveBeenCalledWith(STEAM_ID, 730)
  })

  it("skips a game that has not been played since its last sync (even on forceRefresh)", async () => {
    const mockGetPlayerAchievements = vi.fn()
    mockSteamApi(mockGetPlayerAchievements)

    // syncedAt is "today" (fresh), rtime was two days before — no replay
    const syncedAtIso = new Date().toISOString()
    const twoDaysAgoSeconds = Math.floor((Date.now() - 2 * 24 * 60 * 60 * 1000) / 1000)
    const db = await seedOwnedGames([
      {
        appid: 730,
        name: "CS2",
        syncedAt: syncedAtIso,
        totalCount: 5,
        rtimeLastPlayed: twoDaysAgoSeconds,
      },
    ])
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(syncedAtIso, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    await getStatsForUser(STEAM_ID, { forceRefresh: true })

    expect(mockGetPlayerAchievements).not.toHaveBeenCalled()
  })

  it("weekly safety floor re-syncs untouched games once ACHIEVEMENTS_STALE_MS has elapsed", async () => {
    const mockGetPlayerAchievements = vi.fn().mockResolvedValue({
      steamID: STEAM_ID,
      gameName: "CS2",
      achievements: [{ apiname: "A", achieved: 1, unlocktime: 1 }],
      success: true,
    })
    mockSteamApi(mockGetPlayerAchievements)

    // synced_at is 8 days ago, game never played
    const eightDaysAgoIso = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
    const db = await seedOwnedGames([
      {
        appid: 730,
        name: "CS2",
        syncedAt: eightDaysAgoIso,
        totalCount: 5,
        rtimeLastPlayed: null,
      },
    ])
    const now = new Date().toISOString()
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(now, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    await getStatsForUser(STEAM_ID, { forceRefresh: false })

    expect(mockGetPlayerAchievements).toHaveBeenCalledWith(STEAM_ID, 730)
  })

  it("includes games with NULL has_community_visible_stats (Steam omits the flag for older titles)", async () => {
    const mockGetPlayerAchievements = vi.fn().mockResolvedValue({
      steamID: STEAM_ID,
      gameName: "Assassin's Creed",
      achievements: [
        { apiname: "ACH_ONE", achieved: 1, unlocktime: 1 },
        { apiname: "ACH_TWO", achieved: 1, unlocktime: 2 },
      ],
      success: true,
    })
    mockSteamApi(mockGetPlayerAchievements)

    const db = await seedOwnedGames([
      { appid: 15100, name: "Assassin's Creed", hasStats: null },
      { appid: 999, name: "No Stats Game", hasStats: false },
    ])
    const now = new Date().toISOString()
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(now, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    await getStatsForUser(STEAM_ID, { forceRefresh: false })

    // NULL flag → included (Steam just didn't tell us; we ask directly)
    expect(mockGetPlayerAchievements).toHaveBeenCalledWith(STEAM_ID, 15100)
    // Explicit false → still skipped
    expect(mockGetPlayerAchievements).not.toHaveBeenCalledWith(STEAM_ID, 999)

    const row = db
      .prepare("SELECT unlocked_count, total_count FROM user_games WHERE steam_id = ? AND appid = ?")
      .get(STEAM_ID, 15100) as { unlocked_count: number; total_count: number }
    expect(row).toEqual({ unlocked_count: 2, total_count: 2 })
  })

  it("never-played game is synced once (first sync) then skipped forever after", async () => {
    const mockGetPlayerAchievements = vi.fn().mockResolvedValue({
      steamID: STEAM_ID,
      gameName: "CS2",
      achievements: [{ apiname: "A", achieved: 0, unlocktime: 0 }],
      success: true,
    })
    mockSteamApi(mockGetPlayerAchievements)

    // Never synced, never played: synced_at NULL, rtime_last_played NULL
    const db = await seedOwnedGames([{ appid: 730, name: "CS2", rtimeLastPlayed: null }])
    const now = new Date().toISOString()
    db.prepare(`UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?`).run(now, STEAM_ID)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")

    // First sync: hits Steam
    await getStatsForUser(STEAM_ID, { forceRefresh: false })
    expect(mockGetPlayerAchievements).toHaveBeenCalledTimes(1)

    // Force the stats_snapshot cache to expire so syncAchievementsForStats runs again
    db.prepare(`DELETE FROM stats_snapshot WHERE steam_id = ?`).run(STEAM_ID)

    // Second sync: never played since, should be skipped by the incremental filter
    await getStatsForUser(STEAM_ID, { forceRefresh: false })
    expect(mockGetPlayerAchievements).toHaveBeenCalledTimes(1)
  })
})
