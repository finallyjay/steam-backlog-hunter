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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-extras-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198023709299"

async function seedProfile() {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(STEAM_ID, now, now)
  return db
}

describe("persistExtraGames", () => {
  it("is a no-op when given an empty list", async () => {
    await seedProfile()
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    persistExtraGames(STEAM_ID, [])
    expect(getExtraGamesForUser(STEAM_ID)).toEqual([])
  })

  it("upserts unowned + non-pinned games with playtime > 0", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    // An owned game (must be skipped)
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
       VALUES (?, 620, 1000, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)

    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    persistExtraGames(STEAM_ID, [
      // Already owned — must be skipped
      { appid: 620, playtime_forever: 1000, first_playtime: 1, last_playtime: 2 },
      // Extras
      { appid: 111, playtime_forever: 500, first_playtime: 100, last_playtime: 200 },
      { appid: 222, playtime_forever: 50, first_playtime: 300, last_playtime: 400 },
      // Zero-playtime → skipped (launcher hover)
      { appid: 333, playtime_forever: 0 },
    ])

    const extras = getExtraGamesForUser(STEAM_ID)
    expect(extras.map((e) => e.appid)).toEqual([111, 222])
    // Names remain null until achievements sync fills them in — persistExtraGames
    // itself no longer fetches from the (unreliable) store appdetails API.
    expect(extras[0]).toMatchObject({
      appid: 111,
      playtime_forever: 500,
      rtime_first_played: 100,
      rtime_last_played: 200,
      name: null,
    })
  })

  it("sorts by playtime_forever DESC, then by rtime_last_played DESC", async () => {
    await seedProfile()
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    persistExtraGames(STEAM_ID, [
      { appid: 1, playtime_forever: 100 },
      { appid: 2, playtime_forever: 500 },
      { appid: 3, playtime_forever: 200 },
    ])
    const extras = getExtraGamesForUser(STEAM_ID)
    expect(extras.map((e) => e.appid)).toEqual([2, 3, 1])
  })

  it("re-running updates playtime and preserves first_played via COALESCE", async () => {
    await seedProfile()
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    persistExtraGames(STEAM_ID, [{ appid: 111, playtime_forever: 100, first_playtime: 1000, last_playtime: 2000 }])
    // Second run: new playtime, no first_playtime in response
    persistExtraGames(STEAM_ID, [{ appid: 111, playtime_forever: 150, last_playtime: 3000 }])
    const extras = getExtraGamesForUser(STEAM_ID)
    expect(extras[0].playtime_forever).toBe(150)
    expect(extras[0].rtime_first_played).toBe(1000) // preserved
    expect(extras[0].rtime_last_played).toBe(3000) // updated
  })

  it("also skips pinned-resolved games (which land in user_games with owned=1)", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (274920, 'FaceRig', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
       VALUES (?, 274920, 569, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    persistExtraGames(STEAM_ID, [{ appid: 274920, playtime_forever: 569 }])
    expect(getExtraGamesForUser(STEAM_ID)).toEqual([])
  })

  it("self-heals by deleting extras whose appid is now back in the owned library", async () => {
    // Regression for the post-#131 incident: a transient GetOwnedGames
    // failure wiped user_games.owned and persistExtraGames dumped the
    // whole library into extras. On the next successful sync, Portal 2
    // (etc.) is back in user_games, so the stale extras row must go.
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
       VALUES (?, 620, 600, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
       VALUES (?, 620, 600, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)

    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    // The cleanup runs even when lastPlayed is empty — otherwise a user
    // who'd been wiped couldn't self-heal without new data coming in.
    persistExtraGames(STEAM_ID, [])
    expect(getExtraGamesForUser(STEAM_ID)).toEqual([])
  })
})

describe("getExtraGamesForUser", () => {
  it("returns [] for a user with no extras", async () => {
    await seedProfile()
    const { getExtraGamesForUser } = await import("@/lib/server/extra-games")
    expect(getExtraGamesForUser(STEAM_ID)).toEqual([])
  })

  it("joins with the games name cache so achievement-synced rows surface their name", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    const { persistExtraGames, getExtraGamesForUser } = await import("@/lib/server/extra-games")
    persistExtraGames(STEAM_ID, [{ appid: 111, playtime_forever: 500 }])
    // Simulate the name upsert that persistExtraAchievements does
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (111, 'Recovered Name', ?, ?)`).run(
      now,
      now,
    )
    expect(getExtraGamesForUser(STEAM_ID)[0].name).toBe("Recovered Name")
  })
})

describe("persistExtraAchievements", () => {
  async function seedExtra(appId: number) {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO extra_games (
        steam_id, appid, playtime_forever, synced_at, created_at, updated_at
      ) VALUES (?, ?, 100, ?, ?, ?)`,
    ).run(STEAM_ID, appId, now, now, now)
    return db
  }

  it("writes counts to extra_games + unlocked rows to extra_game_achievements", async () => {
    const db = await seedExtra(111)
    const { persistExtraAchievements } = await import("@/lib/server/extra-games")

    persistExtraAchievements(STEAM_ID, 111, "Refunded Game", [
      { apiname: "ACH_ONE", achieved: 1, unlocktime: 1_700_000_000 },
      { apiname: "ACH_TWO", achieved: 0, unlocktime: 0 },
      { apiname: "ACH_THREE", achieved: 1, unlocktime: 1_700_000_500 },
    ])

    const row = db
      .prepare(
        "SELECT unlocked_count, total_count, perfect_game, achievements_synced_at FROM extra_games WHERE appid=111",
      )
      .get() as { unlocked_count: number; total_count: number; perfect_game: number; achievements_synced_at: string }
    expect(row).toMatchObject({ unlocked_count: 2, total_count: 3, perfect_game: 0 })
    expect(row.achievements_synced_at).toBeTruthy()

    const unlocks = db
      .prepare("SELECT apiname FROM extra_game_achievements WHERE steam_id=? AND appid=111 ORDER BY apiname")
      .all(STEAM_ID) as Array<{ apiname: string }>
    expect(unlocks.map((u) => u.apiname)).toEqual(["ACH_ONE", "ACH_THREE"])

    // Name propagated to the shared games table
    const game = db.prepare("SELECT name FROM games WHERE appid=111").get() as { name: string }
    expect(game.name).toBe("Refunded Game")
  })

  it("does NOT touch user_games or user_achievements (isolation)", async () => {
    const db = await seedExtra(111)
    const now = new Date().toISOString()
    // Seed an unrelated library row
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, unlocked_count, total_count, owned, created_at, updated_at)
       VALUES (?, 620, 100, 29, 51, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)

    const { persistExtraAchievements } = await import("@/lib/server/extra-games")
    persistExtraAchievements(STEAM_ID, 111, "Refunded Game", [{ apiname: "ACH_ONE", achieved: 1, unlocktime: 1 }])

    // Library row untouched
    const library = db.prepare("SELECT unlocked_count, total_count FROM user_games WHERE appid=620").get() as {
      unlocked_count: number
      total_count: number
    }
    expect(library).toEqual({ unlocked_count: 29, total_count: 51 })
    // Nothing written to user_achievements
    const leak = db.prepare("SELECT 1 FROM user_achievements WHERE steam_id=?").get(STEAM_ID)
    expect(leak).toBeUndefined()
  })

  it("flags perfect_game when every achievement is unlocked", async () => {
    const db = await seedExtra(111)
    const { persistExtraAchievements } = await import("@/lib/server/extra-games")
    persistExtraAchievements(STEAM_ID, 111, "Perfect Game", [
      { apiname: "A", achieved: 1, unlocktime: 1 },
      { apiname: "B", achieved: 1, unlocktime: 2 },
    ])
    const row = db
      .prepare("SELECT perfect_game, unlocked_count, total_count FROM extra_games WHERE appid=111")
      .get() as {
      perfect_game: number
      unlocked_count: number
      total_count: number
    }
    expect(row).toEqual({ perfect_game: 1, unlocked_count: 2, total_count: 2 })
  })

  it("marks total_count=0 when passed an empty list (known-broken sentinel)", async () => {
    const db = await seedExtra(111)
    const { persistExtraAchievements } = await import("@/lib/server/extra-games")
    persistExtraAchievements(STEAM_ID, 111, "Broken", [])
    const row = db.prepare("SELECT total_count, achievements_synced_at FROM extra_games WHERE appid=111").get() as {
      total_count: number
      achievements_synced_at: string
    }
    expect(row.total_count).toBe(0)
    expect(row.achievements_synced_at).toBeTruthy()
  })

  it("dedupes duplicate apinames in the input", async () => {
    const db = await seedExtra(111)
    const { persistExtraAchievements } = await import("@/lib/server/extra-games")
    persistExtraAchievements(STEAM_ID, 111, "Dupe", [
      { apiname: "ACH_ONE", achieved: 1, unlocktime: 1 },
      { apiname: "ACH_ONE", achieved: 1, unlocktime: 2 },
    ])
    const rows = db
      .prepare("SELECT apiname FROM extra_game_achievements WHERE steam_id=? AND appid=111")
      .all(STEAM_ID) as Array<{ apiname: string }>
    expect(rows).toHaveLength(1)
  })
})

describe("syncExtraAchievements", () => {
  async function seedExtra(
    appId: number,
    overrides: {
      rtime_last_played?: number | null
      achievements_synced_at?: string | null
      total_count?: number | null
    } = {},
  ) {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO extra_games (
        steam_id, appid, playtime_forever, rtime_last_played, achievements_synced_at,
        total_count, synced_at, created_at, updated_at
      ) VALUES (?, ?, 100, ?, ?, ?, ?, ?, ?)`,
    ).run(
      STEAM_ID,
      appId,
      overrides.rtime_last_played ?? null,
      overrides.achievements_synced_at ?? null,
      overrides.total_count ?? null,
      now,
      now,
      now,
    )
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
  }

  it("syncs a never-synced extras row and persists its counts + name", async () => {
    mockSteamApi({
      getPlayerAchievements: vi.fn().mockResolvedValue({
        steamID: STEAM_ID,
        gameName: "Refunded Game",
        success: true,
        achievements: [{ apiname: "A", achieved: 1, unlocktime: 1 }],
      }),
      getGameSchema: vi.fn().mockResolvedValue(null),
    })
    const db = await seedExtra(111)

    const { syncExtraAchievements } = await import("@/lib/server/extra-games")
    await syncExtraAchievements(STEAM_ID)

    const row = db.prepare("SELECT unlocked_count, total_count FROM extra_games WHERE appid=111").get() as {
      unlocked_count: number
      total_count: number
    }
    expect(row).toEqual({ unlocked_count: 1, total_count: 1 })
    const name = db.prepare("SELECT name FROM games WHERE appid=111").get() as { name: string }
    expect(name.name).toBe("Refunded Game")
  })

  it("marks a null response as broken (total_count=0) so it stops retrying", async () => {
    mockSteamApi({
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getGameSchema: vi.fn().mockResolvedValue(null),
    })
    const db = await seedExtra(111)
    const { syncExtraAchievements } = await import("@/lib/server/extra-games")
    await syncExtraAchievements(STEAM_ID)
    const row = db.prepare("SELECT total_count, achievements_synced_at FROM extra_games WHERE appid=111").get() as {
      total_count: number
      achievements_synced_at: string
    }
    expect(row.total_count).toBe(0)
    expect(row.achievements_synced_at).toBeTruthy()
  })

  it("skips known-broken rows (synced once with total_count=0) without hitting Steam", async () => {
    const getPlayerAchievements = vi.fn()
    mockSteamApi({ getPlayerAchievements })
    await seedExtra(111, {
      achievements_synced_at: new Date().toISOString(),
      total_count: 0,
    })
    const { syncExtraAchievements } = await import("@/lib/server/extra-games")
    await syncExtraAchievements(STEAM_ID)
    expect(getPlayerAchievements).not.toHaveBeenCalled()
  })

  it("skips games not played since last sync (incremental filter)", async () => {
    const getPlayerAchievements = vi.fn()
    mockSteamApi({ getPlayerAchievements })
    const now = Date.now()
    const syncedAt = new Date(now).toISOString()
    // Played two days ago, synced right now → not played since sync
    await seedExtra(111, {
      achievements_synced_at: syncedAt,
      total_count: 5,
      rtime_last_played: Math.floor((now - 2 * 24 * 60 * 60 * 1000) / 1000),
    })
    const { syncExtraAchievements } = await import("@/lib/server/extra-games")
    await syncExtraAchievements(STEAM_ID)
    expect(getPlayerAchievements).not.toHaveBeenCalled()
  })

  it("re-syncs when rtime_last_played is newer than achievements_synced_at", async () => {
    const getPlayerAchievements = vi.fn().mockResolvedValue({
      steamID: STEAM_ID,
      gameName: "Resumed Game",
      success: true,
      achievements: [{ apiname: "A", achieved: 1, unlocktime: 1 }],
    })
    mockSteamApi({ getPlayerAchievements })
    const now = Date.now()
    const oldSync = new Date(now - 10 * 60 * 1000).toISOString() // 10 min ago
    await seedExtra(111, {
      achievements_synced_at: oldSync,
      total_count: 5,
      rtime_last_played: Math.floor(now / 1000), // just now → newer than syncedAt
    })
    const { syncExtraAchievements } = await import("@/lib/server/extra-games")
    await syncExtraAchievements(STEAM_ID)
    expect(getPlayerAchievements).toHaveBeenCalledWith(STEAM_ID, 111)
  })

  it("swallows per-game errors so one failure does not abort the whole sync", async () => {
    const getPlayerAchievements = vi.fn(async (_steamId: string, appId: number) => {
      if (appId === 111) throw new Error("network")
      return {
        steamID: STEAM_ID,
        gameName: "Healthy",
        success: true,
        achievements: [{ apiname: "A", achieved: 1, unlocktime: 1 }],
      }
    })
    mockSteamApi({ getPlayerAchievements })
    const db = await seedProfile()
    const now = new Date().toISOString()
    for (const appid of [111, 222]) {
      db.prepare(
        `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
         VALUES (?, ?, 100, ?, ?, ?)`,
      ).run(STEAM_ID, appid, now, now, now)
    }
    const { syncExtraAchievements } = await import("@/lib/server/extra-games")
    await expect(syncExtraAchievements(STEAM_ID)).resolves.toBeUndefined()

    const healthy = db.prepare("SELECT total_count FROM extra_games WHERE appid=222").get() as { total_count: number }
    expect(healthy.total_count).toBe(1)
    const broken = db.prepare("SELECT total_count FROM extra_games WHERE appid=111").get() as {
      total_count: number | null
    }
    expect(broken.total_count).toBeNull() // never synced
  })
})

describe("hydrateMissingExtraNames", () => {
  type StoreResponse = { success?: boolean; data?: { name?: string } }

  function mockStoreSingle(handler: (appid: number) => StoreResponse) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const appid = Number(url.searchParams.get("appids") ?? "0")
      const body = { [String(appid)]: handler(appid) }
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    }) as unknown as typeof fetch
  }

  async function seedExtraWithoutName(appId: number, playtime = 100) {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(STEAM_ID, appId, playtime, now, now, now)
    return db
  }

  const ORIGINAL_FETCH = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  it("is a no-op when every extras row already has a cached name", async () => {
    const db = await seedExtraWithoutName(111)
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (111, 'Already Cached', ?, ?)`).run(
      now,
      now,
    )
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    expect(fetchSpy).not.toHaveBeenCalled()
    void db
  })

  it("retries rows whose games.name is empty string (no permanent sentinel)", async () => {
    const db = await seedExtraWithoutName(111)
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (111, '', ?, ?)`).run(now, now)
    mockStoreSingle((appid) => ({ success: true, data: { name: `Resolved ${appid}` } }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=111").get() as { name: string }
    expect(row.name).toBe("Resolved 111")
  })

  it("upserts the real name when the store API returns success=true", async () => {
    const db = await seedExtraWithoutName(111)
    mockStoreSingle((appid) => ({ success: true, data: { name: `Game ${appid}` } }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=111").get() as { name: string }
    expect(row.name).toBe("Game 111")
  })

  it("falls back to GetSchemaForGame when store returns success=false", async () => {
    const db = await seedExtraWithoutName(274920)
    mockStoreSingle(() => ({ success: false }))
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue({ gameName: "FaceRig" }),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=274920").get() as { name: string }
    expect(row.name).toBe("FaceRig")
  })

  it("calls the store API once per appid (single-appid queries only)", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    for (const appid of [111, 222, 333]) {
      db.prepare(
        `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
         VALUES (?, ?, 100, ?, ?, ?)`,
      ).run(STEAM_ID, appid, now, now, now)
    }
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      calls.push(url.searchParams.get("appids") ?? "")
      return {
        ok: true,
        status: 200,
        json: async () => ({
          [url.searchParams.get("appids") ?? ""]: { success: true, data: { name: "X" } },
        }),
      } as unknown as Response
    }) as unknown as typeof fetch
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    expect(calls).toHaveLength(3)
    for (const call of calls) expect(call.split(",")).toHaveLength(1)
    void db
  })

  it("orders hydration by playtime_forever DESC so the most-played games come first", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
       VALUES (?, 111, 100, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
       VALUES (?, 222, 500, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
       VALUES (?, 333, 200, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)
    const order: number[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      const appid = Number(url.searchParams.get("appids"))
      order.push(appid)
      return {
        ok: true,
        status: 200,
        json: async () => ({ [String(appid)]: { success: true, data: { name: "X" } } }),
      } as unknown as Response
    }) as unknown as typeof fetch
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    expect(order).toEqual([222, 333, 111])
    void db
  })

  it("backs off after 10 consecutive store API failures", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    for (let i = 1; i <= 15; i++) {
      db.prepare(
        `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(STEAM_ID, i, 100 - i, now, now, now)
    }
    let storeCalls = 0
    // hydrateMissingExtraNames now fetches two hosts per iteration: the
    // store appdetails endpoint (counts toward the back-off) and the
    // community page fallback (independent host, doesn't count). Only
    // increment storeCalls for the store URL so the back-off assertion
    // stays meaningful. Use URL.hostname for an exact host match — CodeQL
    // flags substring matching as incomplete URL sanitization.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const host = new URL(String(input)).hostname
      if (host === "store.steampowered.com") storeCalls++
      return { ok: false, status: 500, json: async () => ({}), text: async () => "" } as unknown as Response
    }) as unknown as typeof fetch
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    expect(storeCalls).toBe(10)
    void db
  })

  it("swallows rejected fetches without throwing", async () => {
    await seedExtraWithoutName(111)
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network")
    }) as unknown as typeof fetch
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await expect(hydrateMissingExtraNames(STEAM_ID)).resolves.toBeUndefined()
  })

  it("is a no-op when the user has no extras at all", async () => {
    await seedProfile()
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ---- Source 3: community-page HTML fallback ----

  function mockStoreFailAndCommunity(communityHtmlByAppId: Record<number, string>) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      // Use exact hostname matching — CodeQL flags substring URL checks
      // as incomplete sanitization.
      if (u.hostname === "store.steampowered.com") {
        // Force the store fallback to return success=false so the chain
        // proceeds to schema (mocked to null) and then to community.
        const appid = u.searchParams.get("appids") ?? "0"
        return {
          ok: true,
          status: 200,
          json: async () => ({ [appid]: { success: false } }),
          text: async () => "",
        } as unknown as Response
      }
      if (u.hostname === "steamcommunity.com") {
        const m = u.pathname.match(/\/app\/(\d+)/)
        const appid = m ? Number(m[1]) : 0
        const html = communityHtmlByAppId[appid] ?? ""
        return { ok: true, status: 200, json: async () => ({}), text: async () => html } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as unknown as Response
    }) as unknown as typeof fetch
  }

  it("falls back to the community page when both store and schema return nothing", async () => {
    const db = await seedExtraWithoutName(502090)
    mockStoreFailAndCommunity({
      502090: "<html><head><title>Steam Community :: Invisible Mind</title></head></html>",
    })
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=502090").get() as { name: string } | undefined
    expect(row?.name).toBe("Invisible Mind")
  })

  it("ignores the community page 'Error' sentinel for unknown appids", async () => {
    const db = await seedExtraWithoutName(999000)
    mockStoreFailAndCommunity({
      999000: "<html><head><title>Steam Community :: Error</title></head></html>",
    })
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=999000").get() as { name: string } | undefined
    expect(row).toBeUndefined()
  })

  it("ignores the 'Welcome to Steam' fallback page for nonexistent appids", async () => {
    const db = await seedExtraWithoutName(999001)
    mockStoreFailAndCommunity({
      999001: "<html><head><title>Welcome to Steam</title></head></html>",
    })
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=999001").get() as { name: string } | undefined
    expect(row).toBeUndefined()
  })

  it("decodes basic HTML entities in community-page titles", async () => {
    const db = await seedExtraWithoutName(123456)
    mockStoreFailAndCommunity({
      123456: "<html><head><title>Steam Community :: Tom Clancy&#39;s Splinter Cell</title></head></html>",
    })
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=123456").get() as { name: string } | undefined
    expect(row?.name).toBe("Tom Clancy's Splinter Cell")
  })

  // ---- Source 3 (inserted between schema and community): Steam Support ----

  function mockStoreSchemaFailThenSupport(supportTitlesByAppId: Record<number, string>) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      if (u.hostname === "store.steampowered.com") {
        const appid = u.searchParams.get("appids") ?? "0"
        return {
          ok: true,
          status: 200,
          json: async () => ({ [appid]: { success: false } }),
          text: async () => "",
        } as unknown as Response
      }
      if (u.hostname === "help.steampowered.com") {
        const appid = Number(u.searchParams.get("appid") ?? "0")
        const title = supportTitlesByAppId[appid] ?? "Steam Support"
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => `<html><head><title>${title}</title></head></html>`,
        } as unknown as Response
      }
      // Community: default to empty so the chain never pulls from it in
      // these tests (we want to prove Support resolved things on its own).
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as unknown as Response
    }) as unknown as typeof fetch
  }

  it("falls back to the Steam Support wizard when store and schema return nothing", async () => {
    const db = await seedExtraWithoutName(489890)
    mockStoreSchemaFailThenSupport({
      489890: "Steam Support - Puzzles At Mystery Manor",
    })
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=489890").get() as { name: string } | undefined
    expect(row?.name).toBe("Puzzles At Mystery Manor")
  })

  it("treats the bare 'Steam Support' title (no dash) as unresolved", async () => {
    const db = await seedExtraWithoutName(615000)
    mockStoreSchemaFailThenSupport({
      615000: "Steam Support", // no " - <name>" suffix → truly dead app
    })
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=615000").get() as { name: string } | undefined
    expect(row).toBeUndefined()
  })

  it("decodes HTML entities in Steam Support titles (e.g. &#39; for apostrophe)", async () => {
    const db = await seedExtraWithoutName(707830)
    mockStoreSchemaFailThenSupport({
      707830: "Steam Support - Injustice&#39;s Online Beta",
    })
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=707830").get() as { name: string } | undefined
    expect(row?.name).toBe("Injustice's Online Beta")
  })

  it("stops calling Steam Support after 5 consecutive 429 responses", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    for (let i = 1; i <= 10; i++) {
      db.prepare(
        `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(STEAM_ID, i, 100 - i, now, now, now)
    }
    let supportCalls = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      if (u.hostname === "store.steampowered.com") {
        const appid = u.searchParams.get("appids") ?? "0"
        return {
          ok: true,
          status: 200,
          json: async () => ({ [appid]: { success: false } }),
          text: async () => "",
        } as unknown as Response
      }
      if (u.hostname === "help.steampowered.com") {
        supportCalls++
        return { ok: false, status: 429, json: async () => ({}), text: async () => "" } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as unknown as Response
    }) as unknown as typeof fetch
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    expect(supportCalls).toBe(5)
    void db
  })

  it("stops calling the community fallback after 5 consecutive 429 responses", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    for (let i = 1; i <= 10; i++) {
      db.prepare(
        `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(STEAM_ID, i, 100 - i, now, now, now)
    }
    let communityCalls = 0
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      if (u.hostname === "store.steampowered.com") {
        const appid = u.searchParams.get("appids") ?? "0"
        return {
          ok: true,
          status: 200,
          json: async () => ({ [appid]: { success: false } }),
          text: async () => "",
        } as unknown as Response
      }
      if (u.hostname === "help.steampowered.com") {
        // Support responds with empty title so the chain moves on to
        // community without incrementing its failure counter.
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => "<html><head><title>Steam Support</title></head></html>",
        } as unknown as Response
      }
      if (u.hostname === "steamcommunity.com") {
        communityCalls++
        return { ok: false, status: 429, json: async () => ({}), text: async () => "" } as unknown as Response
      }
      return { ok: false, status: 404, json: async () => ({}), text: async () => "" } as unknown as Response
    }) as unknown as typeof fetch
    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    expect(communityCalls).toBe(5)
    void db
  })

  it("does not call the community fallback when the store already returned a name", async () => {
    const db = await seedExtraWithoutName(100200)
    let communityCalled = false
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      if (u.hostname === "steamcommunity.com") {
        communityCalled = true
        return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as unknown as Response
      }
      const appid = u.searchParams.get("appids") ?? "0"
      return {
        ok: true,
        status: 200,
        json: async () => ({ [appid]: { success: true, data: { name: "Resolved by store" } } }),
        text: async () => "",
      } as unknown as Response
    }) as unknown as typeof fetch
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    expect(communityCalled).toBe(false)
    const row = db.prepare("SELECT name FROM games WHERE appid=100200").get() as { name: string }
    expect(row.name).toBe("Resolved by store")
  })
})

describe("getExtraAppIds", () => {
  it("returns an empty array for a user with no extras", async () => {
    await seedProfile()
    const { getExtraAppIds } = await import("@/lib/server/extra-games")
    expect(getExtraAppIds(STEAM_ID)).toEqual([])
  })

  it("returns the appids of every extra row for a user", async () => {
    await seedProfile()
    const { persistExtraGames, getExtraAppIds } = await import("@/lib/server/extra-games")
    persistExtraGames(STEAM_ID, [
      { appid: 111, playtime_forever: 100 },
      { appid: 222, playtime_forever: 200 },
    ])
    expect(new Set(getExtraAppIds(STEAM_ID))).toEqual(new Set([111, 222]))
  })
})

describe("getHiddenGamesForUser", () => {
  it("returns empty when nothing is hidden", async () => {
    await seedProfile()
    const { getHiddenGamesForUser } = await import("@/lib/server/extra-games")
    expect(getHiddenGamesForUser(STEAM_ID)).toEqual([])
  })

  it("returns hidden extras with source='extras'", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare("INSERT INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(111, "Test", now, now)
    db.prepare(
      "INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(STEAM_ID, 111, 60, now, now, now)
    db.prepare("INSERT INTO hidden_games (steam_id, appid, hidden_at) VALUES (?, ?, ?)").run(STEAM_ID, 111, now)

    const { getHiddenGamesForUser } = await import("@/lib/server/extra-games")
    const hidden = getHiddenGamesForUser(STEAM_ID)
    expect(hidden).toHaveLength(1)
    expect(hidden[0].appid).toBe(111)
    expect(hidden[0].name).toBe("Test")
    expect(hidden[0].source).toBe("extras")
  })

  it("returns hidden library games with source='library'", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare("INSERT INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      222,
      "Library Game",
      now,
      now,
    )
    db.prepare(
      "INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
    ).run(STEAM_ID, 222, 120, now, now)
    db.prepare("INSERT INTO hidden_games (steam_id, appid, hidden_at) VALUES (?, ?, ?)").run(STEAM_ID, 222, now)

    const { getHiddenGamesForUser } = await import("@/lib/server/extra-games")
    const hidden = getHiddenGamesForUser(STEAM_ID)
    expect(hidden).toHaveLength(1)
    expect(hidden[0].appid).toBe(222)
    expect(hidden[0].source).toBe("library")
  })
})

describe("getExtraGamesForUser filters hidden", () => {
  it("excludes hidden extras from the result", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(STEAM_ID, 111, 60, now, now, now)
    db.prepare(
      "INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(STEAM_ID, 222, 120, now, now, now)
    db.prepare("INSERT INTO hidden_games (steam_id, appid, hidden_at) VALUES (?, ?, ?)").run(STEAM_ID, 111, now)

    const { getExtraGamesForUser } = await import("@/lib/server/extra-games")
    const extras = getExtraGamesForUser(STEAM_ID)
    expect(extras).toHaveLength(1)
    expect(extras[0].appid).toBe(222)
  })
})

describe("getStoredExtraGame", () => {
  it("returns null when extra does not exist", async () => {
    await seedProfile()
    const { getStoredExtraGame } = await import("@/lib/server/extra-games")
    expect(getStoredExtraGame(STEAM_ID, 999)).toBeNull()
  })

  it("returns the extra game with joined game metadata", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare("INSERT INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(111, "Test", now, now)
    db.prepare(
      "INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(STEAM_ID, 111, 60, now, now, now)

    const { getStoredExtraGame } = await import("@/lib/server/extra-games")
    const game = getStoredExtraGame(STEAM_ID, 111)
    expect(game).not.toBeNull()
    expect(game!.appid).toBe(111)
    expect(game!.name).toBe("Test")
    expect(game!.playtime_forever).toBe(60)
  })
})

describe("getExtraAchievementsList", () => {
  it("returns null when extra has no achievements_synced_at", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(
      "INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(STEAM_ID, 111, 60, now, now, now)

    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { getExtraAchievementsList } = await import("@/lib/server/extra-games")
    expect(await getExtraAchievementsList(STEAM_ID, 111)).toBeNull()
    void db
  })

  it("returns enriched achievements when schema and extras data exist", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare("INSERT INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(111, "Test", now, now)
    db.prepare(
      "INSERT INTO extra_games (steam_id, appid, playtime_forever, achievements_synced_at, total_count, unlocked_count, synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(STEAM_ID, 111, 60, now, 2, 1, now, now, now)
    db.prepare(
      "INSERT INTO game_achievements (appid, apiname, display_name, description, icon, icon_gray, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
    ).run(111, "ACH_1", "First Blood", "Get first kill", "icon1.jpg", "gray1.jpg", now, now)
    db.prepare(
      "INSERT INTO game_achievements (appid, apiname, display_name, description, icon, icon_gray, hidden, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
    ).run(111, "ACH_2", "Winner", "Win a match", "icon2.jpg", "gray2.jpg", now, now)
    db.prepare(
      "INSERT INTO extra_game_achievements (steam_id, appid, apiname, achieved, unlock_time, created_at, updated_at) VALUES (?, ?, ?, 1, 1700000000, ?, ?)",
    ).run(STEAM_ID, 111, "ACH_1", now, now)

    vi.doMock("@/lib/steam-api", () => ({
      getGameSchema: vi.fn().mockResolvedValue(null),
      getPlayerAchievements: vi.fn().mockResolvedValue(null),
      getOwnedGames: vi.fn().mockResolvedValue([]),
      getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    }))
    const { getExtraAchievementsList } = await import("@/lib/server/extra-games")
    const achs = await getExtraAchievementsList(STEAM_ID, 111)
    expect(achs).not.toBeNull()
    expect(achs).toHaveLength(2)
    const ach1 = achs!.find((a) => a.apiname === "ACH_1")!
    expect(ach1.achieved).toBe(1)
    expect(ach1.displayName).toBe("First Blood")
    const ach2 = achs!.find((a) => a.apiname === "ACH_2")!
    expect(ach2.achieved).toBe(0)
  })
})
