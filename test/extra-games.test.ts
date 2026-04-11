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

  it("skips rows whose games.name is the empty-string sentinel (negative cache)", async () => {
    const db = await seedExtraWithoutName(111)
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (111, '', ?, ?)`).run(now, now)
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    expect(fetchSpy).not.toHaveBeenCalled()
    void db
  })

  it("upserts the real name when the store API returns success=true", async () => {
    const db = await seedExtraWithoutName(111)
    mockStoreSingle((appid) => ({ success: true, data: { name: `Game ${appid}` } }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=111").get() as { name: string }
    expect(row.name).toBe("Game 111")
  })

  it("writes the empty-string sentinel when the store API says success=false", async () => {
    const db = await seedExtraWithoutName(274920)
    mockStoreSingle(() => ({ success: false }))
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    const row = db.prepare("SELECT name FROM games WHERE appid=274920").get() as { name: string }
    expect(row.name).toBe("")
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

  it("backs off after 5 consecutive store API failures", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    for (let i = 1; i <= 10; i++) {
      db.prepare(
        `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(STEAM_ID, i, 100 - i, now, now, now)
    }
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return { ok: false, status: 500, json: async () => ({}) } as unknown as Response
    }) as unknown as typeof fetch
    const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
    await hydrateMissingExtraNames(STEAM_ID)
    expect(calls).toBe(5)
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
