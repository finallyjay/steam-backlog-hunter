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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-background-refresh-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198023709299"
const DAY_MS = 24 * 60 * 60 * 1000

function mockSteamApi(overrides?: { getOwnedGames?: ReturnType<typeof vi.fn> }) {
  const getOwnedGames =
    overrides?.getOwnedGames ??
    vi
      .fn()
      .mockResolvedValue([{ appid: 620, name: "Portal 2", playtime_forever: 600, has_community_visible_stats: false }])
  vi.doMock("@/lib/steam-api", () => ({
    getGlobalAchievementPercentages: vi.fn().mockResolvedValue(null),
    getOwnedGames,
    getPlayerAchievements: vi.fn().mockResolvedValue(null),
    getGameSchema: vi.fn().mockResolvedValue(null),
    getLastPlayedTimes: vi.fn().mockResolvedValue([]),
  }))
  vi.doMock("@/lib/server/steam-images", () => ({
    ensureGameImages: vi.fn().mockResolvedValue(undefined),
  }))
  vi.doMock("@/lib/server/steam-platforms-sync", () => ({
    syncGamePlatforms: vi.fn().mockResolvedValue(undefined),
  }))
  return { getOwnedGames }
}

/** Seeds a profile, one owned game and a stats snapshot, all `ageMs` old. */
async function seedStoredData(ageMs: number) {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const at = new Date(Date.now() - ageMs).toISOString()
  db.prepare(
    `INSERT INTO steam_profile (steam_id, last_owned_games_sync_at, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  ).run(STEAM_ID, at, at, at)
  db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (440, 'Team Fortress 2', ?, ?)`).run(
    at,
    at,
  )
  db.prepare(
    `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
     VALUES (?, 440, 120, 1, ?, ?)`,
  ).run(STEAM_ID, at, at)
  db.prepare(
    `INSERT INTO stats_snapshot (
      steam_id, total_games, total_achievements, pending_achievements, started_games,
      library_average_completion, total_playtime_minutes, perfect_games, computed_at, updated_at
    ) VALUES (?, 7, 70, 30, 3, 40, 120, 1, ?, ?)`,
  ).run(STEAM_ID, at, at)
  return db
}

describe("stale-while-revalidate reads", () => {
  it("getStatsForUser with allowStale returns a stale snapshot without calling Steam", async () => {
    const { getOwnedGames } = mockSteamApi()
    await seedStoredData(3 * DAY_MS)

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    const stats = await getStatsForUser(STEAM_ID, { allowStale: true })

    expect(stats.totalGames).toBe(7)
    expect(stats.totalAchievements).toBe(70)
    expect(getOwnedGames).not.toHaveBeenCalled()
  })

  it("getStatsForUser with allowStale still syncs inline when there is no snapshot", async () => {
    const { getOwnedGames } = mockSteamApi()

    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    const stats = await getStatsForUser(STEAM_ID, { allowStale: true })

    expect(getOwnedGames).toHaveBeenCalledTimes(1)
    expect(stats.totalGames).toBe(1)
  })

  it("ensureOwnedGamesSynced with allowStale returns the stored library without calling Steam", async () => {
    const { getOwnedGames } = mockSteamApi()
    await seedStoredData(3 * DAY_MS)

    const { ensureOwnedGamesSynced } = await import("@/lib/server/steam-games-sync")
    const games = await ensureOwnedGamesSynced(STEAM_ID, { allowStale: true })

    expect(games.map((game) => game.appid)).toEqual([440])
    expect(getOwnedGames).not.toHaveBeenCalled()
  })

  it("forceRefresh wins over allowStale", async () => {
    const { getOwnedGames } = mockSteamApi()
    await seedStoredData(3 * DAY_MS)

    const { ensureOwnedGamesSynced } = await import("@/lib/server/steam-games-sync")
    await ensureOwnedGamesSynced(STEAM_ID, { forceRefresh: true, allowStale: true })

    expect(getOwnedGames).toHaveBeenCalledTimes(1)
  })
})

describe("refreshUserDataInBackgroundIfStale", () => {
  it("does nothing when the stored data is fresh", async () => {
    const { getOwnedGames } = mockSteamApi()
    await seedStoredData(0)

    const { refreshUserDataInBackgroundIfStale, isBackgroundRefreshRunning } =
      await import("@/lib/server/background-refresh")

    expect(refreshUserDataInBackgroundIfStale(STEAM_ID)).toBe(false)
    expect(isBackgroundRefreshRunning(STEAM_ID)).toBe(false)
    expect(getOwnedGames).not.toHaveBeenCalled()
  })

  it("refreshes stale data in the background, recomputes the snapshot and drops the stats cache", async () => {
    let releaseSteam: () => void = () => {}
    const getOwnedGames = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseSteam = () =>
            resolve([{ appid: 620, name: "Portal 2", playtime_forever: 600, has_community_visible_stats: false }])
        }),
    )
    mockSteamApi({ getOwnedGames })
    const db = await seedStoredData(3 * DAY_MS)

    const { setCachedStats, getCachedStats } = await import("@/lib/server/stats-cache")
    const { refreshUserDataInBackgroundIfStale, isBackgroundRefreshRunning } =
      await import("@/lib/server/background-refresh")
    const { getStatsForUser } = await import("@/lib/server/steam-stats-compute")
    setCachedStats(STEAM_ID, await getStatsForUser(STEAM_ID, { allowStale: true }))

    // Returns synchronously while Steam has not answered yet.
    expect(refreshUserDataInBackgroundIfStale(STEAM_ID)).toBe(true)
    expect(isBackgroundRefreshRunning(STEAM_ID)).toBe(true)
    // A second call joins the running refresh instead of starting another.
    expect(refreshUserDataInBackgroundIfStale(STEAM_ID)).toBe(true)

    await vi.waitFor(() => expect(getOwnedGames).toHaveBeenCalledTimes(1))
    releaseSteam()
    await vi.waitFor(() => expect(isBackgroundRefreshRunning(STEAM_ID)).toBe(false))

    expect(getOwnedGames).toHaveBeenCalledTimes(1)
    expect(getCachedStats(STEAM_ID)).toBeNull()
    const snapshot = db
      .prepare("SELECT total_games, computed_at FROM stats_snapshot WHERE steam_id = ?")
      .get(STEAM_ID) as {
      total_games: number
      computed_at: string
    }
    expect(snapshot.total_games).toBe(1)
    expect(Date.now() - Date.parse(snapshot.computed_at)).toBeLessThan(60_000)
  })

  it("waits for the cooldown before retrying when a refresh leaves the data stale", async () => {
    // GetOwnedGames returning empty with a stored library is treated as a
    // Steam blip: rows are preserved and the sync time is not bumped.
    const { getOwnedGames } = mockSteamApi({ getOwnedGames: vi.fn().mockResolvedValue([]) })
    await seedStoredData(3 * DAY_MS)

    const { refreshUserDataInBackgroundIfStale, isBackgroundRefreshRunning, BACKGROUND_REFRESH_COOLDOWN_MS } =
      await import("@/lib/server/background-refresh")

    expect(refreshUserDataInBackgroundIfStale(STEAM_ID)).toBe(true)
    await vi.waitFor(() => expect(isBackgroundRefreshRunning(STEAM_ID)).toBe(false))
    expect(refreshUserDataInBackgroundIfStale(STEAM_ID)).toBe(false)
    expect(getOwnedGames).toHaveBeenCalledTimes(1)

    const now = Date.now()
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now + BACKGROUND_REFRESH_COOLDOWN_MS + 1)
    try {
      expect(refreshUserDataInBackgroundIfStale(STEAM_ID)).toBe(true)
    } finally {
      nowSpy.mockRestore()
    }
    await vi.waitFor(() => expect(isBackgroundRefreshRunning(STEAM_ID)).toBe(false))
    expect(getOwnedGames).toHaveBeenCalledTimes(2)
  })
})
