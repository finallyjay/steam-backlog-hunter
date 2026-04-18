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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-read-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198023709299"
const APPID_A = 730
const APPID_B = 440

async function seed() {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()

  db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(STEAM_ID, now, now)

  for (const appid of [APPID_A, APPID_B]) {
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
      appid,
      `Game ${appid}`,
      now,
      now,
    )
  }

  // Seed game_achievements (schema) directly — bypass the dual-write path
  // so the test can't pass by accidentally reading achievements_json.
  const insertGameAch = db.prepare(`
    INSERT INTO game_achievements (
      appid, apiname, display_name, description, icon, icon_gray, hidden, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  insertGameAch.run(APPID_A, "ACH_A1", "Alpha One", "First alpha", "a1.jpg", "a1g.jpg", 0, now, now)
  insertGameAch.run(APPID_A, "ACH_A2", "Alpha Two", "Second alpha", "a2.jpg", "a2g.jpg", 0, now, now)
  insertGameAch.run(APPID_B, "ACH_B1", "Bravo One", "First bravo", "b1.jpg", "b1g.jpg", 0, now, now)

  // Mark user_games as owned + synced, but leave achievements_json NULL so
  // only the normalized path can satisfy reads.
  for (const appid of [APPID_A, APPID_B]) {
    db.prepare(
      `INSERT INTO user_games (
        steam_id, appid, playtime_forever, owned, achievements_synced_at,
        unlocked_count, total_count, perfect_game, created_at, updated_at
      ) VALUES (?, ?, 0, 1, ?, 1, 2, 0, ?, ?)`,
    ).run(STEAM_ID, appid, now, now, now)
  }

  // Seed user_achievements for APPID_A only (one unlocked, one locked)
  const insertUserAch = db.prepare(`
    INSERT INTO user_achievements (
      steam_id, appid, apiname, achieved, unlock_time, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  insertUserAch.run(STEAM_ID, APPID_A, "ACH_A1", 1, 1_700_000_000, now, now)
  // ACH_A2 is intentionally absent — LEFT JOIN should yield achieved=0

  return db
}

describe("achievements normalized read path (PR #2)", () => {
  it("getBatchStoredAchievements reads from normalized tables, not achievements_json", async () => {
    await seed()
    const { getBatchStoredAchievements } = await import("@/lib/server/steam-achievements-sync")

    const result = getBatchStoredAchievements(STEAM_ID, [APPID_A, APPID_B])

    expect(Object.keys(result).map(Number).sort()).toEqual([APPID_B, APPID_A])

    expect(result[APPID_A]).toEqual([
      {
        apiname: "ACH_A1",
        achieved: 1,
        unlocktime: 1_700_000_000,
        name: "Alpha One",
        displayName: "Alpha One",
        description: "First alpha",
        icon: "a1.jpg",
        icongray: "a1g.jpg",
        hidden: 0,
        globalPercent: null,
      },
      {
        apiname: "ACH_A2",
        achieved: 0,
        unlocktime: 0,
        name: "Alpha Two",
        displayName: "Alpha Two",
        description: "Second alpha",
        icon: "a2.jpg",
        icongray: "a2g.jpg",
        hidden: 0,
        globalPercent: null,
      },
    ])

    // APPID_B has a schema row but no user_achievements rows — should still
    // return the locked achievement (LEFT JOIN).
    expect(result[APPID_B]).toEqual([
      {
        apiname: "ACH_B1",
        achieved: 0,
        unlocktime: 0,
        name: "Bravo One",
        displayName: "Bravo One",
        description: "First bravo",
        icon: "b1.jpg",
        icongray: "b1g.jpg",
        hidden: 0,
        globalPercent: null,
      },
    ])
  })

  it("getBatchStoredAchievements omits games that were never synced", async () => {
    const db = await seed()
    // Unsync APPID_B — the batch read should drop it entirely rather than
    // return an all-locked stub.
    db.prepare(`UPDATE user_games SET achievements_synced_at = NULL WHERE steam_id = ? AND appid = ?`).run(
      STEAM_ID,
      APPID_B,
    )

    const { getBatchStoredAchievements } = await import("@/lib/server/steam-achievements-sync")

    const result = getBatchStoredAchievements(STEAM_ID, [APPID_A, APPID_B])

    expect(Object.keys(result)).toEqual([String(APPID_A)])
  })

  it("readStoredAchievementsList returns null when the game was never synced", async () => {
    const db = await seed()
    db.prepare(`UPDATE user_games SET achievements_synced_at = NULL WHERE steam_id = ? AND appid = ?`).run(
      STEAM_ID,
      APPID_A,
    )

    const { readStoredAchievementsList } = await import("@/lib/server/steam-achievements-sync")

    expect(readStoredAchievementsList(STEAM_ID, APPID_A)).toBeNull()
  })

  it("readStoredAchievementsList returns the full enriched list via JOIN", async () => {
    await seed()
    const { readStoredAchievementsList } = await import("@/lib/server/steam-achievements-sync")

    const list = readStoredAchievementsList(STEAM_ID, APPID_A)

    expect(list).toHaveLength(2)
    expect(list?.[0]).toMatchObject({ apiname: "ACH_A1", achieved: 1, displayName: "Alpha One" })
    expect(list?.[1]).toMatchObject({ apiname: "ACH_A2", achieved: 0, displayName: "Alpha Two" })
  })

  it("getStoredAchievements returns metadata only (no achievements_json field)", async () => {
    await seed()
    const { getStoredAchievements } = await import("@/lib/server/steam-achievements-sync")

    const meta = getStoredAchievements(STEAM_ID, APPID_A)

    expect(meta).toMatchObject({
      unlocked_count: 1,
      total_count: 2,
      perfect_game: 0,
    })
    expect(meta?.achievements_synced_at).toBeTruthy()
    // achievements_json should not be part of the returned shape anymore
    expect((meta as unknown as { achievements_json?: unknown }).achievements_json).toBeUndefined()
  })
})
