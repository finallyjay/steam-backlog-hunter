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
 * Base schema — only runs on fresh databases (no tables exist yet).
 * For existing databases, numbered migrations handle all changes.
 */
function createBaseSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

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
      rtime_last_played INTEGER,
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

    CREATE INDEX IF NOT EXISTS idx_user_games_steam_id ON user_games(steam_id);
    CREATE INDEX IF NOT EXISTS idx_user_games_steam_id_owned ON user_games(steam_id, owned);
    CREATE INDEX IF NOT EXISTS idx_stats_snapshot_steam_id ON stats_snapshot(steam_id);
  `)
}

/**
 * Each migration is a function that receives the db and runs exactly once.
 * Add new migrations at the end of the array. Never modify existing ones.
 */
const migrations: Array<(db: DatabaseSync) => void> = [
  // Migration 1: Add columns that may be missing on legacy databases
  (db) => {
    const addColumnIfMissing = (table: string, column: string, definition: string) => {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
      }
    }

    addColumnIfMissing("stats_snapshot", "pending_achievements", "INTEGER NOT NULL DEFAULT 0")
    addColumnIfMissing("stats_snapshot", "started_games", "INTEGER NOT NULL DEFAULT 0")
    addColumnIfMissing("stats_snapshot", "steam_average_completion", "REAL NOT NULL DEFAULT 0")
    addColumnIfMissing("stats_snapshot", "library_average_completion", "REAL NOT NULL DEFAULT 0")
    addColumnIfMissing("games", "header_image_url", "TEXT")
    addColumnIfMissing("games", "header_image_synced_at", "TEXT")
    addColumnIfMissing("games", "image_icon_url", "TEXT")
    addColumnIfMissing("games", "image_landscape_url", "TEXT")
    addColumnIfMissing("games", "image_portrait_url", "TEXT")
    addColumnIfMissing("games", "images_synced_at", "TEXT")
    addColumnIfMissing("user_games", "rtime_last_played", "INTEGER")
  },

  // Migration 2: Migrate tracked_games to per-user schema (add steam_id to PK)
  (db) => {
    const cols = db.prepare("PRAGMA table_info(tracked_games)").all() as Array<{ name: string }>
    if (cols.length === 0 || cols.some((c) => c.name === "steam_id")) {
      return // Table doesn't exist or already has steam_id — nothing to do
    }

    db.exec(`
      CREATE TABLE tracked_games_new (
        steam_id TEXT NOT NULL,
        appid INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'seed',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (steam_id, appid),
        FOREIGN KEY (appid) REFERENCES games(appid),
        FOREIGN KEY (steam_id) REFERENCES steam_profile(steam_id)
      );
    `)

    const profile = db.prepare("SELECT steam_id FROM steam_profile LIMIT 1").get() as { steam_id: string } | undefined
    if (profile) {
      const rows = db.prepare("SELECT appid, source, created_at, updated_at FROM tracked_games").all() as Array<{
        appid: number
        source: string
        created_at: string
        updated_at: string
      }>
      const insert = db.prepare(
        "INSERT INTO tracked_games_new (steam_id, appid, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      for (const row of rows) {
        insert.run(profile.steam_id, row.appid, row.source, row.created_at, row.updated_at)
      }
    }

    db.exec(`
      DROP TABLE tracked_games;
      ALTER TABLE tracked_games_new RENAME TO tracked_games;
      CREATE INDEX IF NOT EXISTS idx_tracked_games_steam_id ON tracked_games(steam_id);
    `)
  },

  // Migration 3: Reset achievements_synced_at for games with total_count=0
  // so they get re-discovered after removing the tracked games system.
  // Games that truly have no achievements will be marked again with empty
  // achievements (total_count stays 0, achievements_synced_at gets set).
  (db) => {
    db.prepare(
      `
      UPDATE user_games
      SET achievements_synced_at = NULL
      WHERE total_count = 0 AND achievements_synced_at IS NOT NULL
    `,
    ).run()
  },

  // Migration 4: Create hidden_games table for game blacklist
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hidden_games (
        steam_id TEXT NOT NULL,
        appid INTEGER NOT NULL,
        hidden_at TEXT NOT NULL,
        PRIMARY KEY (steam_id, appid),
        FOREIGN KEY (steam_id) REFERENCES steam_profile(steam_id)
      );
    `)
  },

  // Migration 5: Create allowed_users table and seed from env var
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS allowed_users (
        steam_id TEXT PRIMARY KEY,
        added_by TEXT,
        added_at TEXT NOT NULL
      );
    `)

    const rawWhitelist = process.env.STEAM_WHITELIST_IDS
    if (rawWhitelist) {
      const now = new Date().toISOString()
      const ids = rawWhitelist
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^\d{17}$/.test(id))
      const insert = db.prepare(
        "INSERT OR IGNORE INTO allowed_users (steam_id, added_by, added_at) VALUES (?, 'env_seed', ?)",
      )
      for (const id of ids) {
        insert.run(id, now)
      }
    }
  },

  // Migration 6: Drop legacy tracked_games table (concept removed)
  (db) => {
    db.exec("DROP TABLE IF EXISTS tracked_games;")
  },

  // Migration 7: Add avatar, profile URL, and last login to steam_profile
  (db) => {
    const addColumnIfMissing = (table: string, column: string, definition: string) => {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      if (!cols.some((c) => c.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`)
      }
    }

    addColumnIfMissing("steam_profile", "avatar_url", "TEXT")
    addColumnIfMissing("steam_profile", "profile_url", "TEXT")
    addColumnIfMissing("steam_profile", "last_login_at", "TEXT")
  },

  // Migration 8: Create normalized achievements tables and backfill from
  // existing schema_json / achievements_json blobs. The JSON columns are
  // still dual-written while read paths are migrated in a follow-up.
  (db) => {
    db.exec(`
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
    `)

    const now = new Date().toISOString()

    const insertGameAch = db.prepare(`
      INSERT INTO game_achievements (
        appid, apiname, display_name, description, icon, icon_gray, hidden, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(appid, apiname) DO UPDATE SET
        display_name = excluded.display_name,
        description = excluded.description,
        icon = excluded.icon,
        icon_gray = excluded.icon_gray,
        hidden = excluded.hidden,
        updated_at = excluded.updated_at
    `)

    type SchemaRow = { appid: number; schema_json: string | null }
    const schemaRows = db
      .prepare("SELECT appid, schema_json FROM games WHERE schema_json IS NOT NULL")
      .all() as SchemaRow[]

    for (const row of schemaRows) {
      if (!row.schema_json) continue
      try {
        const schema = JSON.parse(row.schema_json) as {
          availableGameStats?: {
            achievements?: Array<{
              name: string
              displayName?: string
              description?: string
              icon?: string
              icongray?: string
              hidden?: number
            }>
          }
        }
        const list = schema.availableGameStats?.achievements ?? []
        for (const item of list) {
          if (!item.name) continue
          insertGameAch.run(
            row.appid,
            item.name,
            item.displayName ?? null,
            item.description ?? null,
            item.icon ?? null,
            item.icongray ?? null,
            item.hidden ? 1 : 0,
            now,
            now,
          )
        }
      } catch {
        // Skip malformed rows — dual-write will repopulate on next sync.
      }
    }

    const insertUserAch = db.prepare(`
      INSERT INTO user_achievements (
        steam_id, appid, apiname, achieved, unlock_time, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(steam_id, appid, apiname) DO UPDATE SET
        achieved = excluded.achieved,
        unlock_time = excluded.unlock_time,
        updated_at = excluded.updated_at
    `)

    type UserRow = { steam_id: string; appid: number; achievements_json: string | null }
    const userRows = db
      .prepare("SELECT steam_id, appid, achievements_json FROM user_games WHERE achievements_json IS NOT NULL")
      .all() as UserRow[]

    for (const row of userRows) {
      if (!row.achievements_json) continue
      try {
        const list = JSON.parse(row.achievements_json) as Array<{
          apiname: string
          achieved: number
          unlocktime?: number
        }>
        for (const item of list) {
          if (!item.apiname) continue
          insertUserAch.run(
            row.steam_id,
            row.appid,
            item.apiname,
            item.achieved ? 1 : 0,
            item.unlocktime ?? null,
            now,
            now,
          )
        }
      } catch {
        // Skip malformed rows — dual-write will repopulate on next sync.
      }
    }
  },
]

function runMigrations(db: DatabaseSync) {
  // Ensure schema_migrations table exists (for databases created before this system)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as Array<{
    version: number
  }>
  const appliedSet = new Set(applied.map((r) => r.version))
  const pending = migrations.length - appliedSet.size

  if (pending <= 0) {
    return
  }

  console.info(`[sqlite] ${pending} pending migration(s) to apply`)

  for (let i = 0; i < migrations.length; i++) {
    const version = i + 1
    if (appliedSet.has(version)) {
      continue
    }

    console.info(`[sqlite] Applying migration ${version}...`)
    db.exec("BEGIN")
    try {
      migrations[i](db)
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
        version,
        new Date().toISOString(),
      )
      db.exec("COMMIT")
      console.info(`[sqlite] Migration ${version} applied successfully`)
    } catch (error) {
      db.exec("ROLLBACK")
      const msg = `Migration ${version} failed: ${error instanceof Error ? error.message : error}`
      console.error(`[sqlite] ${msg}`)
      throw new Error(msg)
    }
  }
}

export function getSqliteDatabase() {
  if (database) {
    return database
  }

  const dbPath = getDatabasePath()
  mkdirSync(dirname(dbPath), { recursive: true })

  database = new DatabaseSync(dbPath)
  createBaseSchema(database)
  runMigrations(database)

  return database
}
