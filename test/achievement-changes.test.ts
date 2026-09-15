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

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-ach-changes-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

const STEAM_ID = "76561198023709299"
const OTHER_STEAM_ID = "76561198000000001"
const APPID = 620

type Db = Awaited<ReturnType<(typeof import("@/lib/server/sqlite"))["getSqliteDatabase"]>>

async function seedProfileAndGame() {
  const { getSqliteDatabase } = await import("@/lib/server/sqlite")
  const db = getSqliteDatabase()
  const now = new Date().toISOString()
  for (const id of [STEAM_ID, OTHER_STEAM_ID]) {
    db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES (?, ?, ?)`).run(id, now, now)
    db.prepare("UPDATE steam_profile SET last_owned_games_sync_at = ? WHERE steam_id = ?").run(now, id)
  }
  db.prepare(
    `INSERT INTO games (appid, name, has_community_visible_stats, created_at, updated_at)
              VALUES (?, ?, 1, ?, ?)`,
  ).run(APPID, "Portal 2", now, now)
  db.prepare(
    `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
              VALUES (?, ?, 100, 1, ?, ?)`,
  ).run(STEAM_ID, APPID, now, now)
  db.prepare("DELETE FROM pinned_games").run()
  return db
}

/** Stores a schema of `apinames` and marks it freshly synced. */
function seedStoredSchema(db: Db, apinames: string[], syncedAt = new Date().toISOString()) {
  const insert = db.prepare(
    `INSERT INTO game_achievements (appid, apiname, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  )
  for (const name of apinames) insert.run(APPID, name, name, syncedAt, syncedAt)
  db.prepare("UPDATE games SET schema_synced_at = ? WHERE appid = ?").run(syncedAt, APPID)
}

/** Marks the user as having synced `unlocked`/`total` for the game. */
function seedUserProgress(db: Db, steamId: string, unlocked: number, total: number) {
  const now = new Date().toISOString()
  db.prepare(
    `UPDATE user_games SET achievements_synced_at = ?, unlocked_count = ?, total_count = ?, perfect_game = ?
     WHERE steam_id = ? AND appid = ?`,
  ).run(now, unlocked, total, total > 0 && unlocked === total ? 1 : 0, steamId, APPID)
}

function schemaOf(apinames: string[]) {
  return { availableGameStats: { achievements: apinames.map((name) => ({ name, displayName: name })) } }
}

function playerPayload(apinames: string[], unlockedNames: string[] = apinames) {
  return {
    steamID: STEAM_ID,
    gameName: "Portal 2",
    success: true,
    achievements: apinames.map((apiname) => ({
      apiname,
      achieved: unlockedNames.includes(apiname) ? 1 : 0,
      unlocktime: unlockedNames.includes(apiname) ? 1700000000 : 0,
    })),
  }
}

function mockSteamApi(mocks: {
  getPlayerAchievements?: ReturnType<typeof vi.fn>
  getGameSchema?: ReturnType<typeof vi.fn>
}) {
  vi.doMock("@/lib/steam-api", () => ({
    getGlobalAchievementPercentages: vi.fn().mockResolvedValue(null),
    getOwnedGames: vi.fn().mockResolvedValue([]),
    getPlayerAchievements: mocks.getPlayerAchievements ?? vi.fn().mockResolvedValue(null),
    getGameSchema: mocks.getGameSchema ?? vi.fn().mockResolvedValue(null),
    getLastPlayedTimes: vi.fn().mockResolvedValue([]),
    TransientSteamAPIError,
  }))
  vi.doMock("@/lib/server/steam-images", () => ({
    ensureGameImages: vi.fn().mockResolvedValue(undefined),
  }))
}

function readChanges(db: Db, steamId = STEAM_ID) {
  return db
    .prepare(
      `SELECT steam_id, appid, added, removed, total_before, total_after, was_perfect, seen_at
       FROM achievement_changes WHERE steam_id = ? ORDER BY id`,
    )
    .all(steamId) as Array<{
    steam_id: string
    appid: number
    added: string
    removed: string
    total_before: number | null
    total_after: number
    was_perfect: number
    seen_at: string | null
  }>
}

describe("diffApinames", () => {
  it("returns added and removed apinames in a stable order", async () => {
    const { diffApinames } = await import("@/lib/server/achievement-changes")
    expect(diffApinames(["A", "B", "C"], ["B", "C", "D", "E"])).toEqual({ added: ["D", "E"], removed: ["A"] })
    expect(diffApinames(["A"], ["A"])).toEqual({ added: [], removed: [] })
    expect(diffApinames([], ["A"])).toEqual({ added: ["A"], removed: [] })
  })
})

describe("persistSchema change detection (via ensureSchema)", () => {
  it("records new achievements for a previously perfect game and keeps the old total as before", async () => {
    const getSchema = vi.fn().mockResolvedValue(schemaOf(["ACH_ONE", "ACH_TWO", "ACH_THREE"]))
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()
    seedStoredSchema(db, ["ACH_ONE", "ACH_TWO"])
    seedUserProgress(db, STEAM_ID, 2, 2)

    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    const fetched = await ensureSchema(APPID, { forceRefresh: true })
    expect(fetched).toBe(true)

    const rows = readChanges(db)
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]!.added)).toEqual(["ACH_THREE"])
    expect(JSON.parse(rows[0]!.removed)).toEqual([])
    expect(rows[0]!.total_before).toBe(2)
    expect(rows[0]!.total_after).toBe(3)
    expect(rows[0]!.was_perfect).toBe(1)
    expect(rows[0]!.seen_at).toBeNull()

    const schemaRows = db.prepare("SELECT apiname FROM game_achievements WHERE appid = ? ORDER BY apiname").all(APPID)
    expect(schemaRows).toHaveLength(3)
  })

  it("deletes retired achievements from schema and user tables and records them as removed", async () => {
    const getSchema = vi.fn().mockResolvedValue(schemaOf(["ACH_ONE"]))
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()
    seedStoredSchema(db, ["ACH_ONE", "ACH_LEGACY"])
    seedUserProgress(db, STEAM_ID, 1, 2)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO user_achievements (steam_id, appid, apiname, achieved, unlock_time, created_at, updated_at)
       VALUES (?, ?, 'ACH_LEGACY', 1, 1700000000, ?, ?)`,
    ).run(STEAM_ID, APPID, now, now)

    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await ensureSchema(APPID, { forceRefresh: true })

    const rows = readChanges(db)
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]!.added)).toEqual([])
    expect(JSON.parse(rows[0]!.removed)).toEqual(["ACH_LEGACY"])
    expect(rows[0]!.was_perfect).toBe(0)

    const schemaRows = db.prepare("SELECT apiname FROM game_achievements WHERE appid = ?").all(APPID) as Array<{
      apiname: string
    }>
    expect(schemaRows.map((r) => r.apiname)).toEqual(["ACH_ONE"])
    const ghost = db
      .prepare("SELECT 1 FROM user_achievements WHERE steam_id = ? AND appid = ? AND apiname = 'ACH_LEGACY'")
      .get(STEAM_ID, APPID)
    expect(ghost).toBeUndefined()
  })

  it("records one row per owning user with their own before-counts, and none for users who never synced", async () => {
    const getSchema = vi.fn().mockResolvedValue(schemaOf(["ACH_ONE", "ACH_TWO", "ACH_THREE"]))
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
                VALUES (?, ?, 5, 1, ?, ?)`,
    ).run(OTHER_STEAM_ID, APPID, now, now)
    seedStoredSchema(db, ["ACH_ONE", "ACH_TWO"])
    seedUserProgress(db, STEAM_ID, 2, 2)
    // OTHER_STEAM_ID owns the game but has never synced achievements.

    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await ensureSchema(APPID, { forceRefresh: true })

    expect(readChanges(db, STEAM_ID)).toHaveLength(1)
    expect(readChanges(db, OTHER_STEAM_ID)).toHaveLength(0)
  })

  it("does not record anything when the stored and incoming schemas match", async () => {
    const getSchema = vi.fn().mockResolvedValue(schemaOf(["ACH_ONE", "ACH_TWO"]))
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()
    seedStoredSchema(db, ["ACH_ONE", "ACH_TWO"])
    seedUserProgress(db, STEAM_ID, 1, 2)

    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await ensureSchema(APPID, { forceRefresh: true })

    expect(readChanges(db)).toHaveLength(0)
  })

  it("does not record anything on first schema population (no baseline)", async () => {
    const getSchema = vi.fn().mockResolvedValue(schemaOf(["ACH_ONE", "ACH_TWO"]))
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()
    seedUserProgress(db, STEAM_ID, 1, 2)

    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await ensureSchema(APPID)

    expect(readChanges(db)).toHaveLength(0)
    expect(db.prepare("SELECT COUNT(*) AS n FROM game_achievements WHERE appid = ?").get(APPID)).toEqual({ n: 2 })
  })

  it("treats a null schema response as unknown, not as everything removed", async () => {
    const getSchema = vi.fn().mockResolvedValue(null)
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()
    seedStoredSchema(db, ["ACH_ONE", "ACH_TWO"])
    seedUserProgress(db, STEAM_ID, 2, 2)

    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await ensureSchema(APPID, { forceRefresh: true })

    expect(readChanges(db)).toHaveLength(0)
    expect(db.prepare("SELECT COUNT(*) AS n FROM game_achievements WHERE appid = ?").get(APPID)).toEqual({ n: 2 })
  })

  it("skips users whose last sync recorded the 0-achievement sentinel", async () => {
    const getSchema = vi.fn().mockResolvedValue(schemaOf(["ACH_ONE", "ACH_TWO", "ACH_THREE"]))
    mockSteamApi({ getGameSchema: getSchema })
    const db = await seedProfileAndGame()
    seedStoredSchema(db, ["ACH_ONE", "ACH_TWO"])
    seedUserProgress(db, STEAM_ID, 0, 0)

    const { ensureSchema } = await import("@/lib/server/steam-achievements-sync")
    await ensureSchema(APPID, { forceRefresh: true })

    expect(readChanges(db)).toHaveLength(0)
  })
})

describe("syncGameAchievements", () => {
  it("force-refreshes a fresh-but-stale schema when the player payload reveals a new apiname", async () => {
    const getSchema = vi.fn().mockResolvedValue(schemaOf(["ACH_ONE", "ACH_TWO", "ACH_THREE"]))
    const getPlayer = vi
      .fn()
      .mockResolvedValue(playerPayload(["ACH_ONE", "ACH_TWO", "ACH_THREE"], ["ACH_ONE", "ACH_TWO"]))
    mockSteamApi({ getGameSchema: getSchema, getPlayerAchievements: getPlayer })
    const db = await seedProfileAndGame()
    // Schema synced "just now" so ensureSchema would normally skip it.
    seedStoredSchema(db, ["ACH_ONE", "ACH_TWO"])
    seedUserProgress(db, STEAM_ID, 2, 2)

    const { syncGameAchievements } = await import("@/lib/server/steam-achievements-sync")
    await syncGameAchievements(STEAM_ID, APPID)

    expect(getSchema).toHaveBeenCalledTimes(1)
    const rows = readChanges(db)
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0]!.added)).toEqual(["ACH_THREE"])
    expect(rows[0]!.total_before).toBe(2)
    expect(rows[0]!.was_perfect).toBe(1)

    const meta = db
      .prepare("SELECT unlocked_count, total_count, perfect_game FROM user_games WHERE steam_id = ? AND appid = ?")
      .get(STEAM_ID, APPID)
    expect(meta).toEqual({ unlocked_count: 2, total_count: 3, perfect_game: 0 })
    expect(db.prepare("SELECT COUNT(*) AS n FROM game_achievements WHERE appid = ?").get(APPID)).toEqual({ n: 3 })
  })

  it("does not fetch the schema twice when it was already refreshed in the same call", async () => {
    const getSchema = vi.fn().mockResolvedValue(schemaOf(["ACH_ONE", "ACH_TWO", "ACH_THREE"]))
    const getPlayer = vi.fn().mockResolvedValue(playerPayload(["ACH_ONE", "ACH_TWO", "ACH_THREE"]))
    mockSteamApi({ getGameSchema: getSchema, getPlayerAchievements: getPlayer })
    const db = await seedProfileAndGame()
    const stale = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
    seedStoredSchema(db, ["ACH_ONE", "ACH_TWO"], stale)
    seedUserProgress(db, STEAM_ID, 2, 2)

    const { syncGameAchievements } = await import("@/lib/server/steam-achievements-sync")
    await syncGameAchievements(STEAM_ID, APPID)

    expect(getSchema).toHaveBeenCalledTimes(1)
    expect(readChanges(db)).toHaveLength(1)
  })

  it("does not force a refresh when player apinames match the stored schema", async () => {
    const getSchema = vi.fn()
    const getPlayer = vi.fn().mockResolvedValue(playerPayload(["ACH_ONE", "ACH_TWO"], ["ACH_ONE"]))
    mockSteamApi({ getGameSchema: getSchema, getPlayerAchievements: getPlayer })
    const db = await seedProfileAndGame()
    seedStoredSchema(db, ["ACH_ONE", "ACH_TWO"])
    seedUserProgress(db, STEAM_ID, 1, 2)

    const { syncGameAchievements } = await import("@/lib/server/steam-achievements-sync")
    await syncGameAchievements(STEAM_ID, APPID)

    expect(getSchema).not.toHaveBeenCalled()
    expect(readChanges(db)).toHaveLength(0)
  })

  it("does not force a refresh when the schema is unknown locally and the game is a delisted title", async () => {
    // GetSchemaForGame returns null for the game; GetPlayerAchievements works.
    // Without a stored baseline there is nothing to diff, so we must not loop
    // on forced refreshes every sync.
    const getSchema = vi.fn().mockResolvedValue(null)
    const getPlayer = vi.fn().mockResolvedValue(playerPayload(["ACH_ONE"]))
    mockSteamApi({ getGameSchema: getSchema, getPlayerAchievements: getPlayer })
    const db = await seedProfileAndGame()
    db.prepare("UPDATE games SET schema_synced_at = ? WHERE appid = ?").run(new Date().toISOString(), APPID)

    const { syncGameAchievements } = await import("@/lib/server/steam-achievements-sync")
    await syncGameAchievements(STEAM_ID, APPID)

    expect(getSchema).not.toHaveBeenCalled()
  })

  it("persists the 0-achievement sentinel when Steam returns null", async () => {
    const getPlayer = vi.fn().mockResolvedValue(null)
    mockSteamApi({ getPlayerAchievements: getPlayer })
    const db = await seedProfileAndGame()

    const { syncGameAchievements } = await import("@/lib/server/steam-achievements-sync")
    const result = await syncGameAchievements(STEAM_ID, APPID)

    expect(result).toBeNull()
    const meta = db
      .prepare("SELECT achievements_synced_at, total_count FROM user_games WHERE steam_id = ? AND appid = ?")
      .get(STEAM_ID, APPID) as { achievements_synced_at: string | null; total_count: number | null }
    expect(meta.achievements_synced_at).not.toBeNull()
    expect(meta.total_count).toBe(0)
  })
})

describe("listAchievementChanges / markAchievementChangesSeen", () => {
  async function seedChanges(db: Db) {
    const insert = db.prepare(
      `INSERT INTO achievement_changes (steam_id, appid, added, removed, total_before, total_after, was_perfect, detected_at, seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    insert.run(STEAM_ID, APPID, '["A"]', "[]", 2, 3, 1, "2026-09-01T00:00:00.000Z", null)
    insert.run(STEAM_ID, APPID, "[]", '["B"]', 3, 2, 0, "2026-09-02T00:00:00.000Z", "2026-09-03T00:00:00.000Z")
    insert.run(STEAM_ID, APPID, '["C","D"]', "[]", 2, 4, 0, "2026-09-05T00:00:00.000Z", null)
    insert.run(OTHER_STEAM_ID, APPID, '["Z"]', "[]", 1, 2, 0, "2026-09-06T00:00:00.000Z", null)
    return db
  }

  it("lists a user's changes newest first with parsed JSON and the game name", async () => {
    const db = await seedProfileAndGame()
    await seedChanges(db)
    const { listAchievementChanges } = await import("@/lib/server/achievement-changes")

    const all = listAchievementChanges(STEAM_ID)
    expect(all.map((c) => c.detectedAt)).toEqual([
      "2026-09-05T00:00:00.000Z",
      "2026-09-02T00:00:00.000Z",
      "2026-09-01T00:00:00.000Z",
    ])
    expect(all[0]).toMatchObject({
      appId: APPID,
      gameName: "Portal 2",
      added: ["C", "D"],
      removed: [],
      totalBefore: 2,
      totalAfter: 4,
      wasPerfect: false,
      seenAt: null,
    })
    expect(all[2]?.wasPerfect).toBe(true)

    const unseen = listAchievementChanges(STEAM_ID, { unseenOnly: true })
    expect(unseen.map((c) => c.detectedAt)).toEqual(["2026-09-05T00:00:00.000Z", "2026-09-01T00:00:00.000Z"])

    expect(listAchievementChanges(STEAM_ID, { limit: 1 })).toHaveLength(1)
    // A fractional limit must not reach SQLite's LIMIT clause as a REAL.
    expect(listAchievementChanges(STEAM_ID, { limit: 1.5 })).toHaveLength(1)
  })

  it("marks only the given ids, only for the owning user, and leaves already-seen rows untouched", async () => {
    const db = await seedProfileAndGame()
    await seedChanges(db)
    const { listAchievementChanges, markAchievementChangesSeen } = await import("@/lib/server/achievement-changes")

    const [newest] = listAchievementChanges(STEAM_ID, { unseenOnly: true })
    const otherUsersRow = listAchievementChanges(OTHER_STEAM_ID)[0]!

    expect(markAchievementChangesSeen(STEAM_ID, [newest!.id, otherUsersRow.id, 999])).toBe(1)
    expect(listAchievementChanges(STEAM_ID, { unseenOnly: true })).toHaveLength(1)
    expect(listAchievementChanges(OTHER_STEAM_ID, { unseenOnly: true })).toHaveLength(1)

    const seenRow = listAchievementChanges(STEAM_ID).find((c) => c.detectedAt === "2026-09-02T00:00:00.000Z")
    expect(seenRow?.seenAt).toBe("2026-09-03T00:00:00.000Z")
  })

  it("marks every unseen row when no ids are given and ignores invalid ids", async () => {
    const db = await seedProfileAndGame()
    await seedChanges(db)
    const { listAchievementChanges, markAchievementChangesSeen } = await import("@/lib/server/achievement-changes")

    expect(markAchievementChangesSeen(STEAM_ID, [0, -1, 1.5])).toBe(0)
    expect(markAchievementChangesSeen(STEAM_ID)).toBe(2)
    expect(listAchievementChanges(STEAM_ID, { unseenOnly: true })).toHaveLength(0)
    expect(listAchievementChanges(OTHER_STEAM_ID, { unseenOnly: true })).toHaveLength(1)
  })
})
