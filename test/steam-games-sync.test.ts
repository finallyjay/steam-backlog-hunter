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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-games-sync-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198023709299"

function mockSteamApi(
  ownedGames: Array<{ appid: number; name: string; playtime_forever?: number; rtime_last_played?: number }>,
) {
  vi.doMock("@/lib/steam-api", () => ({
    getOwnedGames: vi.fn().mockResolvedValue(
      ownedGames.map((g) => ({
        appid: g.appid,
        name: g.name,
        playtime_forever: g.playtime_forever ?? 0,
        img_icon_url: "",
        img_logo_url: "",
        rtime_last_played: g.rtime_last_played,
      })),
    ),
    getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
    getPlayerAchievements: vi.fn().mockResolvedValue(null),
    getGameSchema: vi.fn().mockResolvedValue(null),
    getLastPlayedTimes: vi.fn().mockResolvedValue([]),
  }))
  vi.doMock("@/lib/server/steam-images", () => ({
    ensureGameImages: vi.fn().mockResolvedValue(undefined),
  }))
}

async function seedBase() {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  // Clear the pinned seed so its extra lookups don't interfere with these tests
  db.prepare("DELETE FROM pinned_games").run()
  return db
}

describe("ensureOwnedGamesSynced", () => {
  it("fetches from Steam on first sync and persists the games", async () => {
    mockSteamApi([
      { appid: 620, name: "Portal 2", playtime_forever: 100 },
      { appid: 440, name: "TF2", playtime_forever: 500, rtime_last_played: 1_700_000_000 },
    ])
    const db = await seedBase()

    const { ensureOwnedGamesSynced } = await import("@/lib/server/steam-games-sync")
    const games = await ensureOwnedGamesSynced(STEAM_ID)
    expect(games).toHaveLength(2)
    const row = db.prepare("SELECT name FROM games WHERE appid = ?").get(620) as { name: string }
    expect(row.name).toBe("Portal 2")
  })

  it("returns cached games without refetching when the sync is fresh", async () => {
    const getOwnedGames = vi.fn().mockResolvedValue([])
    vi.doMock("@/lib/steam-api", () => ({
      getOwnedGames,
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getGameSchema: vi.fn().mockResolvedValue(null),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))
    const db = await seedBase()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO steam_profile (steam_id, last_owned_games_sync_at, created_at, updated_at)
                VALUES (?, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)
    db.prepare(
      `INSERT INTO games (appid, name, has_community_visible_stats, created_at, updated_at)
                VALUES (620, 'Portal 2', 1, ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
                VALUES (?, 620, 100, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)

    const { ensureOwnedGamesSynced } = await import("@/lib/server/steam-games-sync")
    const games = await ensureOwnedGamesSynced(STEAM_ID)
    expect(getOwnedGames).not.toHaveBeenCalled()
    expect(games).toHaveLength(1)
  })

  it("preserves the existing library when GetOwnedGames returns empty (transient failure guard)", async () => {
    // Regression: a transient Steam API failure made getOwnedGames return []
    // and persistOwnedGames' markMissingAsUnowned flipped the whole library
    // to owned=0, which then fed the entire library into extras. Guard:
    // if the fetch comes back empty but we already had a populated library,
    // treat it as a blip and bail without touching user_games.
    mockSteamApi([]) // Steam returns nothing
    const db = await seedBase()
    const oldIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    db.prepare(
      `INSERT INTO steam_profile (steam_id, last_owned_games_sync_at, created_at, updated_at)
                VALUES (?, ?, ?, ?)`,
    ).run(STEAM_ID, oldIso, oldIso, oldIso)
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(
      oldIso,
      oldIso,
    )
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (440, 'TF2', ?, ?)`).run(oldIso, oldIso)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
                VALUES (?, 620, 100, 1, ?, ?)`,
    ).run(STEAM_ID, oldIso, oldIso)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
                VALUES (?, 440, 500, 1, ?, ?)`,
    ).run(STEAM_ID, oldIso, oldIso)

    const { ensureOwnedGamesSynced } = await import("@/lib/server/steam-games-sync")
    const games = await ensureOwnedGamesSynced(STEAM_ID)
    expect(games).toHaveLength(2)

    const owned = db
      .prepare("SELECT appid FROM user_games WHERE steam_id = ? AND owned = 1 ORDER BY appid")
      .all(STEAM_ID) as Array<{ appid: number }>
    expect(owned.map((r) => r.appid)).toEqual([440, 620])
  })

  it("marks games no longer owned as owned=0 on refresh", async () => {
    mockSteamApi([{ appid: 620, name: "Portal 2" }]) // 440 missing from the new fetch
    const db = await seedBase()
    const oldIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    db.prepare(
      `INSERT INTO steam_profile (steam_id, last_owned_games_sync_at, created_at, updated_at)
                VALUES (?, ?, ?, ?)`,
    ).run(STEAM_ID, oldIso, oldIso, oldIso)
    // Pre-existing: both 620 and 440 owned
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (440, 'TF2', ?, ?)`).run(oldIso, oldIso)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
                VALUES (?, 440, 500, 1, ?, ?)`,
    ).run(STEAM_ID, oldIso, oldIso)

    const { ensureOwnedGamesSynced } = await import("@/lib/server/steam-games-sync")
    await ensureOwnedGamesSynced(STEAM_ID)

    const tf2 = db.prepare("SELECT owned FROM user_games WHERE steam_id = ? AND appid = 440").get(STEAM_ID) as {
      owned: number
    }
    expect(tf2.owned).toBe(0)
    const p2 = db.prepare("SELECT owned FROM user_games WHERE steam_id = ? AND appid = 620").get(STEAM_ID) as {
      owned: number
    }
    expect(p2.owned).toBe(1)
  })

  it("forces a refetch when forceRefresh is true, even if the cache is fresh", async () => {
    const getOwnedGames = vi.fn().mockResolvedValue([])
    vi.doMock("@/lib/steam-api", () => ({
      getOwnedGames,
      getRecentlyPlayedGames: vi.fn().mockResolvedValue([]),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getGameSchema: vi.fn().mockResolvedValue(null),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    vi.doMock("@/lib/server/steam-images", () => ({
      ensureGameImages: vi.fn().mockResolvedValue(undefined),
    }))
    const db = await seedBase()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO steam_profile (steam_id, last_owned_games_sync_at, created_at, updated_at)
                VALUES (?, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)

    const { ensureOwnedGamesSynced } = await import("@/lib/server/steam-games-sync")
    await ensureOwnedGamesSynced(STEAM_ID, { forceRefresh: true })
    expect(getOwnedGames).toHaveBeenCalled()
  })
})

describe("getRecentlyPlayedGamesForUser", () => {
  it("returns games with rtime_last_played > 0, ordered desc, respecting the limit", async () => {
    mockSteamApi([])
    const db = await seedBase()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO steam_profile (steam_id, last_owned_games_sync_at, created_at, updated_at)
                VALUES (?, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)
    // 3 games, one with rtime=0 (should be excluded)
    const seedGame = db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    const seedUg = db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, rtime_last_played, owned, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    seedGame.run(620, "Portal 2", now, now)
    seedGame.run(440, "TF2", now, now)
    seedGame.run(300, "Day of Defeat", now, now)
    seedUg.run(STEAM_ID, 620, 100, 1_800_000_000, now, now)
    seedUg.run(STEAM_ID, 440, 500, 1_700_000_000, now, now)
    seedUg.run(STEAM_ID, 300, 10, 0, now, now)

    const { getRecentlyPlayedGamesForUser } = await import("@/lib/server/steam-games-sync")
    const games = await getRecentlyPlayedGamesForUser(STEAM_ID)
    expect(games.map((g) => g.appid)).toEqual([620, 440])
  })

  it("excludes hidden games", async () => {
    mockSteamApi([])
    const db = await seedBase()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO steam_profile (steam_id, last_owned_games_sync_at, created_at, updated_at)
                VALUES (?, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, rtime_last_played, owned, created_at, updated_at)
       VALUES (?, 620, 100, 1_800_000_000, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)
    db.prepare(`INSERT INTO hidden_games (steam_id, appid, hidden_at) VALUES (?, 620, ?)`).run(STEAM_ID, now)

    const { getRecentlyPlayedGamesForUser } = await import("@/lib/server/steam-games-sync")
    const games = await getRecentlyPlayedGamesForUser(STEAM_ID)
    expect(games).toEqual([])
  })
})

describe("getStoredGameForUser", () => {
  it("returns a single game when the user owns it", async () => {
    mockSteamApi([])
    const db = await seedBase()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO steam_profile (steam_id, last_owned_games_sync_at, created_at, updated_at)
                VALUES (?, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
                VALUES (?, 620, 100, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)

    const { getStoredGameForUser } = await import("@/lib/server/steam-games-sync")
    const game = await getStoredGameForUser(STEAM_ID, 620)
    expect(game?.appid).toBe(620)
    expect(game?.name).toBe("Portal 2")
  })

  it("returns null when the user doesn't own the game", async () => {
    mockSteamApi([])
    const db = await seedBase()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO steam_profile (steam_id, last_owned_games_sync_at, created_at, updated_at)
                VALUES (?, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)
    const { getStoredGameForUser } = await import("@/lib/server/steam-games-sync")
    const game = await getStoredGameForUser(STEAM_ID, 999999)
    expect(game).toBeNull()
  })
})

describe("getOwnedGamesForUser", () => {
  it("is a thin alias over ensureOwnedGamesSynced", async () => {
    mockSteamApi([{ appid: 620, name: "Portal 2" }])
    await seedBase()
    const { getOwnedGamesForUser } = await import("@/lib/server/steam-games-sync")
    const games = await getOwnedGamesForUser(STEAM_ID)
    expect(games).toHaveLength(1)
    expect(games[0]?.appid).toBe(620)
  })
})
