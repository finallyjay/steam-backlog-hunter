import "server-only"

import { accessSync, constants, mkdirSync } from "node:fs"
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
    return join(dokployDataDir, "steam-backlog-hunter.sqlite")
  } catch {
    return join(process.cwd(), ".data", "steam-backlog-hunter.sqlite")
  }
}

/**
 * Creates every table the app needs.
 *
 * All statements use `CREATE TABLE IF NOT EXISTS`, so this runs on every
 * startup as an idempotent no-op once the schema is in place. Since this
 * project is not in production, legacy-column migrations have been dropped
 * in favour of this single authoritative schema — existing sqlite files
 * must be deleted before deploying changes that reshape the schema.
 */
function createBaseSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS steam_profile (
      steam_id TEXT PRIMARY KEY,
      persona_name TEXT,
      avatar_url TEXT,
      profile_url TEXT,
      last_login_at TEXT,
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
      image_icon_url TEXT,
      image_landscape_url TEXT,
      image_portrait_url TEXT,
      images_synced_at TEXT,
      has_community_visible_stats INTEGER,
      schema_synced_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_games (
      steam_id TEXT NOT NULL,
      appid INTEGER NOT NULL,
      playtime_forever INTEGER NOT NULL DEFAULT 0,
      playtime_2weeks INTEGER,
      rtime_last_played INTEGER,
      rtime_first_played INTEGER,
      owned INTEGER NOT NULL DEFAULT 1,
      last_seen_in_owned_games_at TEXT,
      achievements_synced_at TEXT,
      unlocked_count INTEGER,
      total_count INTEGER,
      perfect_game INTEGER NOT NULL DEFAULT 0,
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

    CREATE TABLE IF NOT EXISTS hidden_games (
      steam_id TEXT NOT NULL,
      appid INTEGER NOT NULL,
      hidden_at TEXT NOT NULL,
      PRIMARY KEY (steam_id, appid),
      FOREIGN KEY (steam_id) REFERENCES steam_profile(steam_id)
    );

    CREATE TABLE IF NOT EXISTS allowed_users (
      steam_id TEXT PRIMARY KEY,
      added_by TEXT,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS game_achievements (
      appid INTEGER NOT NULL,
      apiname TEXT NOT NULL,
      display_name TEXT,
      description TEXT,
      icon TEXT,
      icon_gray TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      global_percent REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (appid, apiname),
      FOREIGN KEY (appid) REFERENCES games(appid)
    );

    CREATE TABLE IF NOT EXISTS user_achievements (
      steam_id TEXT NOT NULL,
      appid INTEGER NOT NULL,
      apiname TEXT NOT NULL,
      achieved INTEGER NOT NULL DEFAULT 0,
      unlock_time INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (steam_id, appid, apiname),
      FOREIGN KEY (steam_id) REFERENCES steam_profile(steam_id),
      FOREIGN KEY (appid) REFERENCES games(appid)
    );

    CREATE TABLE IF NOT EXISTS pinned_games (
      appid INTEGER PRIMARY KEY,
      reason TEXT,
      added_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_games_steam_id ON user_games(steam_id);
    CREATE INDEX IF NOT EXISTS idx_user_games_steam_id_owned ON user_games(steam_id, owned);
    CREATE INDEX IF NOT EXISTS idx_stats_snapshot_steam_id ON stats_snapshot(steam_id);
  `)
}

/**
 * Seeds pinned_games with known delisted apps that still respond to
 * GetPlayerAchievements.
 *
 * Runs on every database open. INSERT OR IGNORE means editing this list is
 * additive: new entries land on the next startup in both local and
 * production databases without a migration, and existing rows (including
 * any added manually via the admin endpoint) are untouched. Remove an
 * entry here only if you also want it gone in production — the runtime
 * won't re-add it, but it won't delete pre-existing rows either.
 */
const DEFAULT_PINNED_GAMES: ReadonlyArray<readonly [number, string]> = [
  [274920, "FaceRig (delisted 2022)"],
  [245550, "Free to Play (Valve documentary)"],
  [2158860, "JBMod"],
  [432150, "They Came From The Moon"],
  [344040, "Qubburo 2 (appid recycled to Voxelized in current schema)"],
  [327680, "Grind Zones (delisted)"],
]

function seedPinnedGames(db: DatabaseSync) {
  const now = new Date().toISOString()
  const insert = db.prepare("INSERT OR IGNORE INTO pinned_games (appid, reason, added_at) VALUES (?, ?, ?)")
  for (const [appid, reason] of DEFAULT_PINNED_GAMES) {
    insert.run(appid, reason, now)
  }
}

/**
 * Seeds `allowed_users` from the STEAM_WHITELIST_IDS environment variable.
 *
 * Idempotent (INSERT OR IGNORE) and runs on every database open — cheap
 * enough to keep out of any migration machinery.
 */
function seedAllowedUsersFromEnv(db: DatabaseSync) {
  const rawWhitelist = process.env.STEAM_WHITELIST_IDS
  if (!rawWhitelist) return

  const ids = rawWhitelist
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d{17}$/.test(id))
  if (ids.length === 0) return

  const now = new Date().toISOString()
  const insert = db.prepare(
    "INSERT OR IGNORE INTO allowed_users (steam_id, added_by, added_at) VALUES (?, 'env_seed', ?)",
  )
  for (const id of ids) {
    insert.run(id, now)
  }
}

/**
 * Additive-only schema evolution: adds a column to an existing table if it's
 * not already there. Safe on both fresh and existing databases, since the
 * CREATE TABLE IF NOT EXISTS in createBaseSchema already defines the latest
 * shape for new installs. This helper handles the "users with old databases"
 * case without dropping data.
 */
function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((c) => c.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

function applyAdditiveMigrations(db: DatabaseSync) {
  // Unix timestamp of the first time this user played this game, sourced
  // from ClientGetLastPlayedTimes. Nullable because older rows may not have
  // been enriched yet.
  addColumnIfMissing(db, "user_games", "rtime_first_played", "INTEGER")
}

export function getSqliteDatabase() {
  if (database) {
    return database
  }

  const dbPath = getDatabasePath()
  mkdirSync(dirname(dbPath), { recursive: true })

  database = new DatabaseSync(dbPath)
  createBaseSchema(database)
  applyAdditiveMigrations(database)
  seedAllowedUsersFromEnv(database)
  seedPinnedGames(database)

  return database
}
