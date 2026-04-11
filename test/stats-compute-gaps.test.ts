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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-stats-gaps-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198023709299"

async function seedFreshProfile(iso?: string) {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  db.prepare("DELETE FROM pinned_games").run()
  const now = iso ?? new Date().toISOString()
  db.prepare(
    `INSERT INTO steam_profile (steam_id, last_owned_games_sync_at, created_at, updated_at)
              VALUES (?, ?, ?, ?)`,
  ).run(STEAM_ID, now, now, now)
  return { db, now }
}

function mockSteamApi() {
  vi.doMock("@/lib/steam-api", () => ({
    getOwnedGames: vi.fn().mockResolvedValue([]),
    getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
    getPlayerAchievements: vi.fn().mockResolvedValue(null),
    getGameSchema: vi.fn().mockResolvedValue(null),
    getLastPlayedTimes: vi.fn().mockResolvedValue([]),
  }))
  vi.doMock("@/lib/server/steam-images", () => ({
    ensureGameImages: vi.fn().mockResolvedValue(undefined),
  }))
}

describe("getStatsForUser — cached snapshot branch", () => {
  it("returns the cached snapshot without re-syncing achievements when fresh", async () => {
    mockSteamApi()
    const { db } = await seedFreshProfile()
    const now = new Date().toISOString()
    // Seed a fresh stats_snapshot row
    db.prepare(
      `INSERT INTO stats_snapshot (
        steam_id, total_games, total_achievements, pending_achievements, started_games,
        library_average_completion, total_playtime_minutes, perfect_games, computed_at, updated_at
      ) VALUES (?, 10, 100, 50, 5, 42, 600, 2, ?, ?)`,
    ).run(STEAM_ID, now, now)

    // Seed one game with achievements so achCount > 0
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, total_count, unlocked_count, owned, created_at, updated_at)
       VALUES (?, 620, 0, 51, 29, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    const stats = await getStatsForUser(STEAM_ID, { forceRefresh: false })

    expect(stats.totalGames).toBe(10)
    expect(stats.totalAchievements).toBe(100)
    expect(stats.gamesWithAchievements).toBe(1) // live SELECT COUNT(*)
    expect(stats.averageCompletion).toBe(42)
    expect(stats.totalPlaytime).toBe(10)
    expect(stats.perfectGames).toBe(2)
  })
})

describe("getUserSyncStatus", () => {
  it("returns null values when no profile has been synced", async () => {
    mockSteamApi()
    const { getUserSyncStatus } = await import("@/lib/server/steam-stats-compute")
    const status = getUserSyncStatus(STEAM_ID)
    expect(status).toEqual({
      lastOwnedGamesSyncAt: null,
      lastRecentGamesSyncAt: null,
      lastStatsSyncAt: null,
    })
  })

  it("returns real timestamps when the profile + snapshot have been synced", async () => {
    mockSteamApi()
    // Pass a fixed iso so all three timestamps compared below match exactly,
    // independent of wall-clock drift between seed and subsequent calls.
    const iso = "2026-04-11T10:00:00.000Z"
    const { db } = await seedFreshProfile(iso)
    db.prepare("UPDATE steam_profile SET last_recent_games_sync_at = ? WHERE steam_id = ?").run(iso, STEAM_ID)
    db.prepare(
      `INSERT INTO stats_snapshot (
        steam_id, total_games, total_achievements, pending_achievements, started_games,
        library_average_completion, total_playtime_minutes, perfect_games, computed_at, updated_at
      ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
    ).run(STEAM_ID, iso, iso)

    const { getUserSyncStatus } = await import("@/lib/server/steam-stats-compute")
    const status = getUserSyncStatus(STEAM_ID)
    expect(status.lastOwnedGamesSyncAt).toBe(iso)
    expect(status.lastRecentGamesSyncAt).toBe(iso)
    expect(status.lastStatsSyncAt).toBe(iso)
  })
})

describe("synchronizeUserData", () => {
  it("returns summarised counts and the freshly computed stats object", async () => {
    vi.doMock("@/lib/steam-api", () => ({
      getOwnedGames: vi.fn().mockResolvedValue([
        {
          appid: 620,
          name: "Portal 2",
          playtime_forever: 100,
          img_icon_url: "",
          img_logo_url: "",
          rtime_last_played: 1_800_000_000,
        },
      ]),
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: vi.fn().mockResolvedValue({
        steamID: STEAM_ID,
        gameName: "Portal 2",
        success: true,
        achievements: [{ apiname: "ACH_ONE", achieved: 1, unlocktime: 1 }],
      }),
      getGameSchema: vi.fn().mockResolvedValue(null),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))

    await seedFreshProfile()
    const { synchronizeUserData } = await import("@/lib/server/steam-stats-compute")
    const result = await synchronizeUserData(STEAM_ID)
    expect(result.ownedGames).toBe(1)
    expect(result.recentGames).toBe(1) // Portal 2 has rtime > 0
    expect(result.stats.totalGames).toBe(1)
    expect(result.stats.totalAchievements).toBe(1)
    expect(typeof result.syncedAt).toBe("string")
  })
})

describe("getStoredStatsSnapshot", () => {
  it("returns undefined for a user with no snapshot", async () => {
    const { getStoredStatsSnapshot } = await import("@/lib/server/steam-stats-compute")
    expect(getStoredStatsSnapshot(STEAM_ID)).toBeUndefined()
  })
})
