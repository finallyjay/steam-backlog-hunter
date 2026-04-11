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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-pinned-test-"))
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

describe("ensurePinnedGamesSynced", () => {
  it("upserts a pinned appid that Steam confirms ownership of", async () => {
    const mockGetPlayerAchievements = vi.fn().mockResolvedValue({
      steamID: STEAM_ID,
      gameName: "FaceRig",
      achievements: [{ apiname: "A", achieved: 1, unlocktime: 1 }],
      success: true,
    })
    vi.doMock("@/lib/steam-api", () => ({
      getPlayerAchievements: mockGetPlayerAchievements,
    }))

    const db = await seedProfile()
    // Clear the default seed so we control what's pinned in each test
    db.prepare("DELETE FROM pinned_games").run()
    const { addPinnedGame, ensurePinnedGamesSynced } = await import("@/lib/server/pinned-games")
    addPinnedGame(274920, "FaceRig")

    await ensurePinnedGamesSynced(STEAM_ID, new Set<number>())

    expect(mockGetPlayerAchievements).toHaveBeenCalledWith(STEAM_ID, 274920)
    const game = db.prepare("SELECT name, has_community_visible_stats FROM games WHERE appid = ?").get(274920) as {
      name: string
      has_community_visible_stats: number
    }
    expect(game).toEqual({ name: "FaceRig", has_community_visible_stats: 1 })

    const ug = db
      .prepare("SELECT owned, playtime_forever FROM user_games WHERE steam_id = ? AND appid = ?")
      .get(STEAM_ID, 274920) as { owned: number; playtime_forever: number }
    expect(ug).toEqual({ owned: 1, playtime_forever: 0 })
  })

  it("does nothing when Steam says the user does not own the pinned appid", async () => {
    const mockGetPlayerAchievements = vi.fn().mockResolvedValue(null)
    vi.doMock("@/lib/steam-api", () => ({
      getPlayerAchievements: mockGetPlayerAchievements,
    }))

    const db = await seedProfile()
    db.prepare("DELETE FROM pinned_games").run()
    const { addPinnedGame, ensurePinnedGamesSynced } = await import("@/lib/server/pinned-games")
    addPinnedGame(999999, "Unowned")

    await ensurePinnedGamesSynced(STEAM_ID, new Set<number>())

    expect(mockGetPlayerAchievements).toHaveBeenCalledWith(STEAM_ID, 999999)
    const game = db.prepare("SELECT 1 FROM games WHERE appid = ?").get(999999)
    expect(game).toBeUndefined()
    const ug = db.prepare("SELECT 1 FROM user_games WHERE steam_id = ? AND appid = ?").get(STEAM_ID, 999999)
    expect(ug).toBeUndefined()
  })

  it("skips pinned appids already present in the owned-games response", async () => {
    const mockGetPlayerAchievements = vi.fn()
    vi.doMock("@/lib/steam-api", () => ({
      getPlayerAchievements: mockGetPlayerAchievements,
    }))

    const db = await seedProfile()
    db.prepare("DELETE FROM pinned_games").run()
    const { addPinnedGame, ensurePinnedGamesSynced } = await import("@/lib/server/pinned-games")
    addPinnedGame(1408720, "Krunker")

    // Steam already returned Krunker in GetOwnedGames
    await ensurePinnedGamesSynced(STEAM_ID, new Set<number>([1408720]))
    expect(mockGetPlayerAchievements).not.toHaveBeenCalled()
  })

  it("swallows per-appid errors so one failure does not abort the sync", async () => {
    const mockGetPlayerAchievements = vi.fn(async (_steamId: string, appId: number) => {
      if (appId === 999999) throw new Error("network blip")
      return {
        steamID: STEAM_ID,
        gameName: `App ${appId}`,
        achievements: [{ apiname: "A", achieved: 1, unlocktime: 1 }],
        success: true,
      }
    })
    vi.doMock("@/lib/steam-api", () => ({
      getPlayerAchievements: mockGetPlayerAchievements,
    }))

    const db = await seedProfile()
    db.prepare("DELETE FROM pinned_games").run()
    const { addPinnedGame, ensurePinnedGamesSynced } = await import("@/lib/server/pinned-games")
    addPinnedGame(999999, "bad")
    addPinnedGame(274920, "good")

    await ensurePinnedGamesSynced(STEAM_ID, new Set<number>())

    const good = db.prepare("SELECT 1 FROM user_games WHERE steam_id = ? AND appid = ?").get(STEAM_ID, 274920)
    expect(good).toBeDefined()
    const bad = db.prepare("SELECT 1 FROM user_games WHERE steam_id = ? AND appid = ?").get(STEAM_ID, 999999)
    expect(bad).toBeUndefined()
  })
})

describe("pinned_games seed", () => {
  it("seeds the default delisted apps on first db open", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const rows = db.prepare("SELECT appid FROM pinned_games ORDER BY appid").all() as Array<{ appid: number }>
    const ids = rows.map((r) => r.appid).sort((a, b) => a - b)
    expect(ids).toEqual([245550, 274920, 327680, 344040, 432150, 2158860])
  })
})
