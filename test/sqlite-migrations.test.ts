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
  tmpDir = mkdtempSync(join(tmpdir(), "sbh-migration-test-"))
  process.env.SQLITE_PATH = join(tmpDir, "test.sqlite")
  vi.resetModules()
})

afterEach(() => {
  delete process.env.SQLITE_PATH
  rmSync(tmpDir, { recursive: true, force: true })
})

describe("versioned migrations", () => {
  it("bumps PRAGMA user_version to the latest migration after first open", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const { user_version } = db.prepare("PRAGMA user_version").get() as { user_version: number }
    // Latest migration index is 2 at the time of writing. Bumping this
    // on new entries is intentional — it catches append-only history
    // violations.
    expect(user_version).toBeGreaterThanOrEqual(2)
  })

  it("migration v1 resets placeholder-named games + their extras cache", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    // The DB opens with all migrations already applied, so to test v1
    // we rewind the version and re-seed some placeholder rows, then
    // re-run the migration loop by re-importing the module. Simpler:
    // seed rows that the migration would still catch on a second
    // invocation — the migration is idempotent.
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES ('1', ?, ?)`).run(now, now)
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (111, 'UntitledApp0', ?, ?)`).run(
      now,
      now,
    )
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (222, 'GreenlightApp42', ?, ?)`).run(
      now,
      now,
    )
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (333, 'Portal 2', ?, ?)`).run(now, now)
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, total_count, achievements_synced_at, synced_at, created_at, updated_at)
       VALUES ('1', 111, 100, 5, ?, ?, ?, ?), ('1', 222, 100, 3, ?, ?, ?, ?)`,
    ).run(now, now, now, now, now, now, now, now)

    // Rewind and re-run migrations.
    db.exec("PRAGMA user_version = 0")
    vi.resetModules()
    await import("@/lib/server/sqlite").then((m) => m.getSqliteDatabase())

    const row111 = db.prepare(`SELECT name FROM games WHERE appid = 111`).get() as { name: string }
    const row222 = db.prepare(`SELECT name FROM games WHERE appid = 222`).get() as { name: string }
    const row333 = db.prepare(`SELECT name FROM games WHERE appid = 333`).get() as { name: string }
    expect(row111.name).toBe("")
    expect(row222.name).toBe("")
    expect(row333.name).toBe("Portal 2") // not a placeholder — left alone

    const cache111 = db
      .prepare(`SELECT total_count, achievements_synced_at FROM extra_games WHERE steam_id = '1' AND appid = 111`)
      .get() as { total_count: number | null; achievements_synced_at: string | null }
    expect(cache111.total_count).toBeNull()
    expect(cache111.achievements_synced_at).toBeNull()
  })

  it("migration v1 preserves manual names (name_source='manual')", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const now = new Date().toISOString()
    // Seed a placeholder row that was manually named afterwards — the
    // admin panel flow. Migration must not clobber the admin's work.
    db.prepare(
      `INSERT INTO games (appid, name, name_source, created_at, updated_at) VALUES (444, 'ValveTestApp444', 'manual', ?, ?)`,
    ).run(now, now)

    db.exec("PRAGMA user_version = 0")
    vi.resetModules()
    await import("@/lib/server/sqlite").then((m) => m.getSqliteDatabase())

    const row = db.prepare(`SELECT name, name_source FROM games WHERE appid = 444`).get() as {
      name: string
      name_source: string
    }
    // Even though the name matches the placeholder pattern, the
    // manual source protects it.
    expect(row.name).toBe("ValveTestApp444")
    expect(row.name_source).toBe("manual")
  })

  it("migration v2 resets extras with total=0 and synced_at set", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO steam_profile (steam_id, created_at, updated_at) VALUES ('1', ?, ?)`).run(now, now)

    // Stale "known-broken" row (pre-v0.10.3 sentinel). Migration v2
    // should reset the cache so the next sync retries via the schema
    // fallback path.
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, total_count, achievements_synced_at, synced_at, created_at, updated_at)
       VALUES ('1', 24200, 100, 0, ?, ?, ?, ?)`,
    ).run(now, now, now, now)

    // Healthy row with a real total. Migration v2 must NOT touch it.
    db.prepare(
      `INSERT INTO extra_games (steam_id, appid, playtime_forever, total_count, unlocked_count, achievements_synced_at, synced_at, created_at, updated_at)
       VALUES ('1', 321110, 100, 30, 0, ?, ?, ?, ?)`,
    ).run(now, now, now, now)

    db.exec("PRAGMA user_version = 1")
    vi.resetModules()
    await import("@/lib/server/sqlite").then((m) => m.getSqliteDatabase())

    const broken = db
      .prepare(`SELECT total_count, achievements_synced_at FROM extra_games WHERE appid = 24200`)
      .get() as { total_count: number | null; achievements_synced_at: string | null }
    expect(broken.total_count).toBeNull()
    expect(broken.achievements_synced_at).toBeNull()

    const healthy = db
      .prepare(`SELECT total_count, achievements_synced_at FROM extra_games WHERE appid = 321110`)
      .get() as { total_count: number; achievements_synced_at: string }
    expect(healthy.total_count).toBe(30)
    expect(healthy.achievements_synced_at).toBeTruthy()
  })

  it("migrations are not re-run when user_version is already at the latest", async () => {
    const { getSqliteDatabase } = await import("@/lib/server/sqlite")
    const db = getSqliteDatabase()
    const now = new Date().toISOString()

    // After first open, user_version should be at the latest. Seed a
    // placeholder row AFTER migrations and confirm re-opening the DB
    // does NOT wipe it (because the migration already ran once).
    db.prepare(`INSERT INTO games (appid, name, created_at, updated_at) VALUES (555, 'ValveTestApp555', ?, ?)`).run(
      now,
      now,
    )

    // Re-open without rewinding user_version.
    vi.resetModules()
    await import("@/lib/server/sqlite").then((m) => m.getSqliteDatabase())

    const row = db.prepare(`SELECT name FROM games WHERE appid = 555`).get() as { name: string }
    // Still the placeholder — migration v1 ran once on first open,
    // user_version bumped, second open skips it.
    expect(row.name).toBe("ValveTestApp555")
  })
})
