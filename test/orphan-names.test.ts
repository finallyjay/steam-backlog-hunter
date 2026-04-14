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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-orphan-test-"))
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

describe("listOrphanNames", () => {
  it("returns empty when there are no extras or library rows", async () => {
    await seedProfile()
    const { listOrphanNames } = await import("@/lib/server/orphan-names")
    expect(listOrphanNames()).toEqual([])
  })

  it("returns extras whose games row has empty name", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (615000, '', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
       VALUES (?, 615000, 180, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)

    const { listOrphanNames } = await import("@/lib/server/orphan-names")
    const rows = listOrphanNames()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      appid: 615000,
      sources: ["extras"],
      playtime_forever: 180,
    })
  })

  it("returns library rows whose games row is missing or unnamed", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (813000, '', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
       VALUES (?, 813000, 42, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)

    const { listOrphanNames } = await import("@/lib/server/orphan-names")
    const rows = listOrphanNames()
    expect(rows).toHaveLength(1)
    expect(rows[0].sources).toEqual(["library"])
  })

  it("skips games with a non-empty name regardless of source", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (620, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
       VALUES (?, 620, 1000, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)

    const { listOrphanNames } = await import("@/lib/server/orphan-names")
    expect(listOrphanNames()).toEqual([])
  })

  it("orders rows by playtime descending so the most-played nameless apps come first", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    for (const appid of [1, 2, 3]) {
      db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (?, '', ?, ?)`).run(appid, now, now)
    }
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
       VALUES (?, 1, 50, ?, ?, ?), (?, 2, 500, ?, ?, ?), (?, 3, 200, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now, STEAM_ID, now, now, now, STEAM_ID, now, now, now)

    const { listOrphanNames } = await import("@/lib/server/orphan-names")
    const rows = listOrphanNames()
    expect(rows.map((r) => r.appid)).toEqual([2, 3, 1])
  })

  it("dedupes appids referenced by both library and extras into a single row", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (205, '', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO user_games (steam_id, appid, playtime_forever, owned, created_at, updated_at)
       VALUES (?, 205, 10, 1, ?, ?)`,
    ).run(STEAM_ID, now, now)
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
       VALUES (?, 205, 30, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)

    const { listOrphanNames } = await import("@/lib/server/orphan-names")
    const rows = listOrphanNames()
    expect(rows).toHaveLength(1)
    expect(rows[0].sources.sort()).toEqual(["extras", "library"])
    expect(rows[0].playtime_forever).toBe(30) // MAX across sources
  })
})

describe("setManualName", () => {
  it("upserts a new row with name_source='manual'", async () => {
    const db = await seedProfile()
    const { setManualName } = await import("@/lib/server/orphan-names")
    setManualName(489890, "Puzzles At Mystery Manor")
    const row = db.prepare("SELECT name, name_source FROM games WHERE appid = 489890").get() as {
      name: string
      name_source: string
    }
    expect(row.name).toBe("Puzzles At Mystery Manor")
    expect(row.name_source).toBe("manual")
  })

  it("freezes an existing row's name by flipping name_source to 'manual'", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (489890, '', ?, ?)`).run(now, now)
    const { setManualName } = await import("@/lib/server/orphan-names")
    setManualName(489890, "Puzzles At Mystery Manor")
    const row = db.prepare("SELECT name, name_source FROM games WHERE appid = 489890").get() as {
      name: string
      name_source: string
    }
    expect(row.name).toBe("Puzzles At Mystery Manor")
    expect(row.name_source).toBe("manual")
  })

  it("trims whitespace around the name", async () => {
    const db = await seedProfile()
    const { setManualName } = await import("@/lib/server/orphan-names")
    setManualName(1, "  Spaced  ")
    const row = db.prepare("SELECT name FROM games WHERE appid = 1").get() as { name: string }
    expect(row.name).toBe("Spaced")
  })

  it("rejects empty names", async () => {
    await seedProfile()
    const { setManualName } = await import("@/lib/server/orphan-names")
    expect(() => setManualName(1, "   ")).toThrow(RangeError)
  })

  it("rejects names longer than 200 chars", async () => {
    await seedProfile()
    const { setManualName } = await import("@/lib/server/orphan-names")
    expect(() => setManualName(1, "x".repeat(201))).toThrow(RangeError)
  })
})

describe("clearManualName", () => {
  it("resets a manual name to empty + name_source='auto'", async () => {
    const db = await seedProfile()
    const { setManualName, clearManualName } = await import("@/lib/server/orphan-names")
    setManualName(1, "Temporary")
    clearManualName(1)
    const row = db.prepare("SELECT name, name_source FROM games WHERE appid = 1").get() as {
      name: string
      name_source: string
    }
    expect(row.name).toBe("")
    expect(row.name_source).toBe("auto")
  })

  it("leaves auto-sourced rows untouched (no-op)", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO games (appid, name, name_source, created_at, updated_at) VALUES (1, 'Real', 'auto', ?, ?)`,
    ).run(now, now)
    const { clearManualName } = await import("@/lib/server/orphan-names")
    clearManualName(1)
    const row = db.prepare("SELECT name, name_source FROM games WHERE appid = 1").get() as {
      name: string
      name_source: string
    }
    expect(row.name).toBe("Real")
    expect(row.name_source).toBe("auto")
  })
})

describe("manual-name preservation across upserts", () => {
  it("persistOwnedGames does NOT overwrite a manual name", async () => {
    const db = await seedProfile()
    const { setManualName } = await import("@/lib/server/orphan-names")
    setManualName(620, "My Custom Portal 2 Name")

    const { persistOwnedGames } = await import("@/lib/server/steam-games-sync")
    persistOwnedGames(STEAM_ID, [
      {
        appid: 620,
        name: "Portal 2",
        playtime_forever: 1000,
        img_icon_url: "icon",
        img_logo_url: "logo",
        has_community_visible_stats: true,
      },
    ])

    const row = db.prepare("SELECT name, icon_hash, name_source FROM games WHERE appid = 620").get() as {
      name: string
      icon_hash: string
      name_source: string
    }
    expect(row.name).toBe("My Custom Portal 2 Name") // preserved
    expect(row.icon_hash).toBe("icon") // still refreshed
    expect(row.name_source).toBe("manual")
  })

  it("persistExtraAchievements does NOT overwrite a manual name", async () => {
    const db = await seedProfile()
    const { setManualName } = await import("@/lib/server/orphan-names")
    setManualName(111, "Manual Override")

    const { persistExtraGames, persistExtraAchievements } = await import("@/lib/server/extra-games")
    persistExtraGames(STEAM_ID, [{ appid: 111, playtime_forever: 100 }])
    persistExtraAchievements(STEAM_ID, 111, "Auto Name From Steam", [])

    const row = db.prepare("SELECT name FROM games WHERE appid = 111").get() as { name: string }
    expect(row.name).toBe("Manual Override")
  })

  it("hydrateMissingExtraNames skips rows with name_source='manual' even if name is empty", async () => {
    const db = await seedProfile()
    const now = new Date().toISOString()
    // Simulate a row where the admin set a manual name and then later
    // cleared the text (shouldn't normally happen, but the guard still
    // holds) AND the row is listed in extras.
    db.prepare(
      `INSERT INTO games (appid, name, name_source, created_at, updated_at) VALUES (999, '', 'manual', ?, ?)`,
    ).run(now, now)
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, synced_at, created_at, updated_at)
       VALUES (?, 999, 100, ?, ?, ?)`,
    ).run(STEAM_ID, now, now, now)

    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    try {
      const { hydrateMissingExtraNames } = await import("@/lib/server/extra-games")
      await hydrateMissingExtraNames(STEAM_ID)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      // @ts-expect-error restore globals
      delete globalThis.fetch
    }
  })
})
