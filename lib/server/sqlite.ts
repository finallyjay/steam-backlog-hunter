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

  if (!hasPendingAchievementsColumn) {
    db.exec("ALTER TABLE stats_snapshot ADD COLUMN pending_achievements INTEGER NOT NULL DEFAULT 0;")
  }

  seedTrackedGames(db)
}

function seedTrackedGames(db: DatabaseSync) {
  const jsonPath = join(process.cwd(), "public", "steam_games_with_achievements.json")
  if (!existsSync(jsonPath)) {
    return
  }

  const rawJson = readFileSync(jsonPath, "utf-8")
  const games = JSON.parse(rawJson) as Array<{ id: number }>
  const now = new Date().toISOString()
  const insertTrackedGame = db.prepare(`
    INSERT INTO tracked_games (appid, source, created_at, updated_at)
    VALUES (?, 'seed', ?, ?)
    ON CONFLICT(appid) DO NOTHING
  `)

  db.exec("BEGIN")
  try {
    for (const game of games) {
      insertTrackedGame.run(game.id, now, now)
    }
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
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
