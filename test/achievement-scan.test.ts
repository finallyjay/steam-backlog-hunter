// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TransientSteamAPIError } from "@/lib/steam-api"

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

const ALLOWED = "76561198023709299"
const REVOKED = "76561198000000002"
const NEVER_SYNCED = "76561198000000003"

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-scan-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  process.env.STEAM_WHITELIST_IDS = ALLOWED
  delete process.env.ADMIN_STEAM_ID
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  delete process.env.STEAM_WHITELIST_IDS
  rmSync(tmpDir, { recursive: true, force: true })
})

type Db = ReturnType<(typeof import("@/lib/server/sqlite"))["getSqliteDatabase"]>

async function openDb(): Promise<Db> {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  db.prepare("DELETE FROM pinned_games").run()
  return db
}

function seedProfile(db: Db, steamId: string, synced: boolean) {
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(steamId, now, now)
  if (synced) {
    db.prepare("UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?").run(now, steamId)
  }
}

function seedGame(
  db: Db,
  steamId: string,
  appid: number,
  opts: { unlocked: number; total: number; lastPlayed?: number; schema?: string[] },
) {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT OR IGNORE INTO games (appid, name, has_community_visible_stats, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
  ).run(appid, `Game ${appid}`, now, now)
  db.prepare(
    `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, achievements_synced_at, unlocked_count, total_count, perfect_game, rtime_last_played, created_at, updated_at)
     VALUES (?, ?, 10, 1, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    steamId,
    appid,
    now,
    opts.unlocked,
    opts.total,
    opts.total > 0 && opts.unlocked === opts.total ? 1 : 0,
    opts.lastPlayed ?? 0,
    now,
    now,
  )
  if (opts.schema) {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO game_achievements (appid, apiname, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
    for (const name of opts.schema) insert.run(appid, name, name, now, now)
    db.prepare("UPDATE games SET schema_synced_at = ? WHERE appid = ?").run(now, appid)
  }
}

function payload(steamId: string, apinames: string[], unlocked: string[] = apinames) {
  return {
    steamID: steamId,
    gameName: "x",
    success: true,
    achievements: apinames.map((apiname) => ({
      apiname,
      achieved: unlocked.includes(apiname) ? 1 : 0,
      unlocktime: unlocked.includes(apiname) ? 1700000000 : 0,
    })),
  }
}

function mockSteamApi(mocks: {
  getPlayerAchievements: ReturnType<typeof vi.fn>
  getGameSchema?: ReturnType<typeof vi.fn>
}) {
  vi.doMock("@/lib/steam-api", () => ({
    getGlobalAchievementPercentages: vi.fn().mockResolvedValue(null),
    getOwnedGames: vi.fn().mockResolvedValue([]),
    getPlayerAchievements: mocks.getPlayerAchievements,
    getGameSchema: mocks.getGameSchema ?? vi.fn().mockResolvedValue(null),
    getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    TransientSteamAPIError,
  }))
  vi.doMock("@/lib/server/steam-images", () => ({
    ensureGameImages: vi.fn().mockResolvedValue(undefined),
  }))
}

describe("listScanUsers", () => {
  it("returns whitelisted users with a completed owned-games sync only", async () => {
    const db = await openDb()
    seedProfile(db, ALLOWED, true)
    seedProfile(db, REVOKED, true)
    seedProfile(db, NEVER_SYNCED, false)
    db.prepare("INSERT OR IGNORE INTO allowed_users (steam_id, added_by, added_at) VALUES (?, 'test', ?)").run(
      NEVER_SYNCED,
      new Date().toISOString(),
    )

    const { listScanUsers } = await import("@/lib/server/achievement-scan")
    expect(listScanUsers()).toEqual([ALLOWED])
  })

  it("includes the admin even when not in the whitelist", async () => {
    process.env.ADMIN_STEAM_ID = REVOKED
    const db = await openDb()
    seedProfile(db, REVOKED, true)

    const { listScanUsers } = await import("@/lib/server/achievement-scan")
    expect(listScanUsers()).toEqual([REVOKED])
  })
})

describe("listScanGames", () => {
  it("orders perfect games first, then in-progress, then not started, and honours the cap", async () => {
    const db = await openDb()
    seedProfile(db, ALLOWED, true)
    seedGame(db, ALLOWED, 100, { unlocked: 0, total: 5, lastPlayed: 50 })
    seedGame(db, ALLOWED, 200, { unlocked: 3, total: 5, lastPlayed: 10 })
    seedGame(db, ALLOWED, 300, { unlocked: 5, total: 5, lastPlayed: 1 })
    seedGame(db, ALLOWED, 400, { unlocked: 2, total: 5, lastPlayed: 99 })
    seedGame(db, ALLOWED, 500, { unlocked: 0, total: 0 })

    const { listScanGames } = await import("@/lib/server/achievement-scan")
    expect(listScanGames(ALLOWED)).toEqual([300, 400, 200, 100])
    expect(listScanGames(ALLOWED, 2)).toEqual([300, 400])
    expect(listScanGames(ALLOWED, 2.9)).toEqual([300, 400])
  })
})

describe("runAchievementScan", () => {
  it("re-syncs every game, detects schema changes and records the run", async () => {
    const db = await openDb()
    seedProfile(db, ALLOWED, true)
    seedGame(db, ALLOWED, 620, { unlocked: 2, total: 2, schema: ["A", "B"] })
    seedGame(db, ALLOWED, 730, { unlocked: 1, total: 3, schema: ["X", "Y", "Z"] })

    const getPlayer = vi.fn(async (_steamId: string, appId: number) =>
      appId === 620 ? payload(ALLOWED, ["A", "B", "C"], ["A", "B"]) : payload(ALLOWED, ["X", "Y", "Z"], ["X"]),
    )
    const getSchema = vi.fn(async (appId: number) =>
      appId === 620
        ? { availableGameStats: { achievements: ["A", "B", "C"].map((name) => ({ name, displayName: name })) } }
        : null,
    )
    mockSteamApi({ getPlayerAchievements: getPlayer, getGameSchema: getSchema })

    const { runAchievementScan, getLastAchievementScan, isAchievementScanRunning } =
      await import("@/lib/server/achievement-scan")
    const promise = runAchievementScan()
    expect(isAchievementScanRunning()).toBe(true)
    const result = await promise
    expect(isAchievementScanRunning()).toBe(false)

    expect(getPlayer).toHaveBeenCalledTimes(2)
    expect(result.usersScanned).toBe(1)
    expect(result.gamesScanned).toBe(2)
    expect(result.changesDetected).toBe(1)
    expect(result.failures).toBe(0)
    expect(result.users[0]).toMatchObject({ steamId: ALLOWED, gamesScanned: 2, changesDetected: 1, failures: 0 })

    const change = db
      .prepare("SELECT appid, added, was_perfect FROM achievement_changes WHERE steam_id = ?")
      .get(ALLOWED) as { appid: number; added: string; was_perfect: number }
    expect(change).toEqual({ appid: 620, added: '["C"]', was_perfect: 1 })

    const meta = getLastAchievementScan()
    expect(meta).toMatchObject({ usersScanned: 1, gamesScanned: 2, changesDetected: 1, failures: 0 })
    expect(meta?.finishedAt).not.toBeNull()
  })

  it("counts per-game failures without aborting and respects maxGamesPerUser", async () => {
    const db = await openDb()
    seedProfile(db, ALLOWED, true)
    seedGame(db, ALLOWED, 1, { unlocked: 5, total: 5 })
    seedGame(db, ALLOWED, 2, { unlocked: 1, total: 5 })
    seedGame(db, ALLOWED, 3, { unlocked: 0, total: 5 })

    const getPlayer = vi.fn(async (_steamId: string, appId: number) => {
      if (appId === 2) throw new Error("steam down")
      return payload(ALLOWED, ["A"], [])
    })
    mockSteamApi({ getPlayerAchievements: getPlayer })

    const { runAchievementScan } = await import("@/lib/server/achievement-scan")
    const result = await runAchievementScan({ maxGamesPerUser: 2 })

    expect(getPlayer.mock.calls.map((c) => c[1]).sort()).toEqual([1, 2])
    expect(result.gamesScanned).toBe(2)
    expect(result.failures).toBe(1)
  })

  it("joins an in-flight scan instead of starting a second one", async () => {
    const db = await openDb()
    seedProfile(db, ALLOWED, true)
    seedGame(db, ALLOWED, 1, { unlocked: 1, total: 2 })

    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const getPlayer = vi.fn(async () => {
      await gate
      return payload(ALLOWED, ["A", "B"], ["A"])
    })
    mockSteamApi({ getPlayerAchievements: getPlayer })

    const { runAchievementScan } = await import("@/lib/server/achievement-scan")
    const first = runAchievementScan()
    const second = runAchievementScan()
    release()
    const [a, b] = await Promise.all([first, second])
    expect(b).toEqual(a)
    expect(getPlayer).toHaveBeenCalledTimes(1)
  })

  it("scans nothing when no user qualifies", async () => {
    const db = await openDb()
    seedProfile(db, NEVER_SYNCED, false)
    const getPlayer = vi.fn()
    mockSteamApi({ getPlayerAchievements: getPlayer })

    const { runAchievementScan } = await import("@/lib/server/achievement-scan")
    const result = await runAchievementScan()
    expect(result.usersScanned).toBe(0)
    expect(result.gamesScanned).toBe(0)
    expect(getPlayer).not.toHaveBeenCalled()
  })
})
