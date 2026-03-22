import "server-only"

import { accessSync, constants, existsSync, mkdirSync, readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { dirname, join } from "node:path"

let database: DatabaseSync | null = null

function getDatabasePath() {
  if (process.env.SQLITE_PATH) {
    return process.env.SQLITE_PATH
  }

  const dokployDataDir = "/data"
  try {
    accessSync(dokployDataDir, constants.W_OK)
    return join(dokployDataDir, "steam-achievements-tracker.sqlite")
  } catch {
    return join(process.cwd(), ".data", "steam-achievements-tracker.sqlite")
  }
}

function initializeSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS steam_profile (
      steam_id TEXT PRIMARY KEY,
      persona_name TEXT,
      last_owned_games_sync_at TEXT,
      last_recent_games_sync_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      appid INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      icon_hash TEXT,
      logo_hash TEXT,
      has_community_visible_stats INTEGER,
      schema_json TEXT,
      schema_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_games (
      steam_id TEXT NOT NULL,
      appid INTEGER NOT NULL,
      playtime_forever INTEGER NOT NULL DEFAULT 0,
      playtime_2weeks INTEGER,
      owned INTEGER NOT NULL DEFAULT 1,
      last_seen_in_owned_games_at TEXT,
      achievements_synced_at TEXT,
      unlocked_count INTEGER,
      total_count INTEGER,
      perfect_game INTEGER NOT NULL DEFAULT 0,
      achievements_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (steam_id, appid),
      FOREIGN KEY (appid) REFERENCES games(appid),
      FOREIGN KEY (steam_id) REFERENCES steam_profile(steam_id)
    );

    CREATE TABLE IF NOT EXISTS recent_games_snapshot (
      steam_id TEXT PRIMARY KEY,
      games_json TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (steam_id) REFERENCES steam_profile(steam_id)
    );

    CREATE TABLE IF NOT EXISTS stats_snapshot (
      steam_id TEXT PRIMARY KEY,
      total_games INTEGER NOT NULL,
      total_achievements INTEGER NOT NULL,
      pending_achievements INTEGER NOT NULL DEFAULT 0,
      started_games INTEGER NOT NULL DEFAULT 0,
      steam_average_completion REAL NOT NULL DEFAULT 0,
      library_average_completion REAL NOT NULL DEFAULT 0,
      total_playtime_minutes INTEGER NOT NULL,
      perfect_games INTEGER NOT NULL,
      computed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (steam_id) REFERENCES steam_profile(steam_id)
    );

    CREATE TABLE IF NOT EXISTS tracked_games (
      appid INTEGER PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'seed',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (appid) REFERENCES games(appid)
    );

    CREATE INDEX IF NOT EXISTS idx_user_games_steam_id ON user_games(steam_id);
    CREATE INDEX IF NOT EXISTS idx_user_games_steam_id_owned ON user_games(steam_id, owned);
  `)

  const statsSnapshotColumns = db.prepare("PRAGMA table_info(stats_snapshot)").all() as Array<{ name: string }>
  const hasPendingAchievementsColumn = statsSnapshotColumns.some((column) => column.name === "pending_achievements")
  const hasStartedGamesColumn = statsSnapshotColumns.some((column) => column.name === "started_games")
  const hasSteamAverageCompletionColumn = statsSnapshotColumns.some((column) => column.name === "steam_average_completion")
  const hasLibraryAverageCompletionColumn = statsSnapshotColumns.some((column) => column.name === "library_average_completion")

  if (!hasPendingAchievementsColumn) {
    db.exec("ALTER TABLE stats_snapshot ADD COLUMN pending_achievements INTEGER NOT NULL DEFAULT 0;")
  }

  if (!hasStartedGamesColumn) {
    db.exec("ALTER TABLE stats_snapshot ADD COLUMN started_games INTEGER NOT NULL DEFAULT 0;")
  }

  if (!hasSteamAverageCompletionColumn) {
    db.exec("ALTER TABLE stats_snapshot ADD COLUMN steam_average_completion REAL NOT NULL DEFAULT 0;")
  }

  if (!hasLibraryAverageCompletionColumn) {
    db.exec("ALTER TABLE stats_snapshot ADD COLUMN library_average_completion REAL NOT NULL DEFAULT 0;")
  }

  reseedTrackedGames(db)
}

function parseTrackedGamesSeed(rawJson: string): number[] {
  const parsed = JSON.parse(rawJson) as unknown
  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
}

function reseedTrackedGames(db: DatabaseSync): number {
  const jsonPath = join(process.cwd(), "lib", "data", "tracked-games-seed.json")
  if (!existsSync(jsonPath)) {
    return 0
  }

  const rawJson = readFileSync(jsonPath, "utf-8")
  const appIds = Array.from(new Set(parseTrackedGamesSeed(rawJson)))
  const now = new Date().toISOString()
  const insertPlaceholderGame = db.prepare(`
    INSERT INTO games (
      appid,
      name,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(appid) DO NOTHING
  `)
  const insertTrackedGame = db.prepare(`
    INSERT INTO tracked_games (appid, source, created_at, updated_at)
    VALUES (?, 'seed', ?, ?)
    ON CONFLICT(appid) DO UPDATE SET
      updated_at = excluded.updated_at
  `)
  const deleteMissingSeedGames = db.prepare(`
    DELETE FROM tracked_games
    WHERE source = 'seed' AND appid NOT IN (${appIds.map(() => "?").join(",")})
  `)
  const deleteAllSeedGames = db.prepare(`
    DELETE FROM tracked_games
    WHERE source = 'seed'
  `)

  db.exec("BEGIN")
  try {
    for (const appId of appIds) {
      insertPlaceholderGame.run(appId, `Steam app ${appId}`, now, now)
      insertTrackedGame.run(appId, now, now)
    }

    if (appIds.length > 0) {
      deleteMissingSeedGames.run(...appIds)
    } else {
      deleteAllSeedGames.run()
    }

    db.exec("COMMIT")
    return appIds.length
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}

export function reseedTrackedGamesFromFile() {
  const db = getSqliteDatabase()
  return reseedTrackedGames(db)
}

export function getSqliteDatabase() {
  if (database) {
    return database
  }

  const dbPath = getDatabasePath()
  mkdirSync(dirname(dbPath), { recursive: true })

  database = new DatabaseSync(dbPath)
  initializeSchema(database)

  return database
}
