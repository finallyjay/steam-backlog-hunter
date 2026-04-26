import "server-only"

import { accessSync, constants, mkdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { dirname, join } from "node:path"

import { PLACEHOLDER_NAME_SQL_MATCH_BARE } from "@/lib/server/placeholder-names"

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
      -- Provenance of the name column. 'auto' means any sync path
      -- (catalog, store, schema, support wizard, community page) may
      -- overwrite it on subsequent upserts. 'manual' is set when the
      -- admin types a name in /admin/orphan-names and freezes the
      -- value: every upsert path keeps the existing name when
      -- name_source='manual', but still refreshes images/icons/stats
      -- flags so the row stays current.
      name_source TEXT NOT NULL DEFAULT 'auto',
      icon_hash TEXT,
      logo_hash TEXT,
      image_icon_url TEXT,
      image_landscape_url TEXT,
      image_portrait_url TEXT,
      images_synced_at TEXT,
      has_community_visible_stats INTEGER,
      schema_synced_at TEXT,
      -- JSON object {windows: bool, mac: bool, linux: bool} sourced from
      -- store appdetails. NULL means we haven't probed this appid yet.
      platforms TEXT,
      platforms_synced_at TEXT,
      -- Release year parsed from store appdetails. NULL means either we
      -- haven't probed yet OR Steam reports an empty release_date (a
      -- common signal that a duplicate-named appid is a stripped legacy
      -- listing kept for ownership only — see GTA III 12230).
      release_year INTEGER,
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

    -- Games the user has played at some point but no longer owns in the
    -- traditional sense: refunded, family-shared, delisted, removed from
    -- library, etc. Sourced from ClientGetLastPlayedTimes minus the ids we
    -- already treat as owned (user_games.owned = 1). Fully isolated from
    -- user_games so nothing in here can contaminate library stats.
    CREATE TABLE IF NOT EXISTS extra_games (
      steam_id TEXT NOT NULL,
      appid INTEGER NOT NULL,
      playtime_forever INTEGER NOT NULL DEFAULT 0,
      rtime_first_played INTEGER,
      rtime_last_played INTEGER,
      achievements_synced_at TEXT,
      unlocked_count INTEGER,
      total_count INTEGER,
      perfect_game INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (steam_id, appid),
      FOREIGN KEY (steam_id) REFERENCES steam_profile(steam_id)
    );

    -- Per-user unlocked achievements for games in extra_games. Intentionally
    -- a separate table from user_achievements so there is zero possibility of
    -- an extras row leaking into library stats via a forgotten WHERE clause.
    CREATE TABLE IF NOT EXISTS extra_game_achievements (
      steam_id TEXT NOT NULL,
      appid INTEGER NOT NULL,
      apiname TEXT NOT NULL,
      achieved INTEGER NOT NULL DEFAULT 0,
      unlock_time INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (steam_id, appid, apiname),
      FOREIGN KEY (steam_id) REFERENCES steam_profile(steam_id)
    );

    -- Single-row tracking table for the bulk import of Steam's canonical
    -- app catalog (IStoreService/GetAppList). Records when we last seeded
    -- the games table with the 200k+ entries that cover Tools, Software
    -- and SDK apps the per-appid resolution endpoints cannot name. Used
    -- by the populate routine to throttle itself to one run per week.
    CREATE TABLE IF NOT EXISTS app_catalog_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      populated_at TEXT NOT NULL,
      entry_count INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_games_steam_id ON user_games(steam_id);
    CREATE INDEX IF NOT EXISTS idx_user_games_steam_id_owned ON user_games(steam_id, owned);
    CREATE INDEX IF NOT EXISTS idx_stats_snapshot_steam_id ON stats_snapshot(steam_id);
    CREATE INDEX IF NOT EXISTS idx_extra_games_steam_id ON extra_games(steam_id);
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
  // Achievement metadata for extras — only present on databases that already
  // had extra_games before we added achievement sync.
  addColumnIfMissing(db, "extra_games", "achievements_synced_at", "TEXT")
  addColumnIfMissing(db, "extra_games", "unlocked_count", "INTEGER")
  addColumnIfMissing(db, "extra_games", "total_count", "INTEGER")
  addColumnIfMissing(db, "extra_games", "perfect_game", "INTEGER NOT NULL DEFAULT 0")
  // Provenance of games.name. See CREATE TABLE comment above.
  addColumnIfMissing(db, "games", "name_source", "TEXT NOT NULL DEFAULT 'auto'")
  // Platform support (windows/mac/linux) sourced from store appdetails. Used
  // by the UI to disambiguate same-named games across platforms.
  addColumnIfMissing(db, "games", "platforms", "TEXT")
  addColumnIfMissing(db, "games", "platforms_synced_at", "TEXT")
  // Release year sourced from the same appdetails probe as platforms —
  // used by the UI as a secondary disambiguator when same-named editions
  // share identical platform support.
  addColumnIfMissing(db, "games", "release_year", "INTEGER")
  runVersionedMigrations(db)
}

/**
 * Version-gated migrations tracked via SQLite's built-in
 * `PRAGMA user_version`. Each migration runs once per database and
 * bumps the stored version. Fresh installs jump straight to the
 * latest version on first open; upgraded installs replay every
 * migration whose index is greater than the currently stored
 * version, in order.
 *
 * Adding a new migration: append an entry to MIGRATIONS below and
 * bump its index. Never modify or reorder existing entries — this
 * is an append-only history.
 */
const MIGRATIONS: Array<{ version: number; name: string; run: (db: DatabaseSync) => void }> = [
  {
    version: 1,
    name: "reset-placeholder-game-names",
    /**
     * Any `games` row whose `name` matches one of Valve's internal
     * placeholders (ValveTestAppX, UntitledApp, GreenlightAppX,
     * InvitedPartnerAppX) is reset so the extras hydrate chain can
     * re-resolve the real title via the Steam Support wizard on the
     * next sync. Manual admin names (`name_source='manual'`) are
     * preserved. Also clears the corresponding `extra_games`
     * achievement cache so the sync path re-runs through the schema
     * fallback and gets the correct total.
     */
    run(db) {
      db.exec(`
        UPDATE extra_games
        SET achievements_synced_at = NULL,
            unlocked_count = NULL,
            total_count = NULL,
            perfect_game = 0
        WHERE appid IN (SELECT appid FROM games WHERE ${PLACEHOLDER_NAME_SQL_MATCH_BARE});
      `)
      db.exec(`
        UPDATE games
        SET name = '',
            updated_at = COALESCE(updated_at, '1970-01-01T00:00:00Z')
        WHERE ${PLACEHOLDER_NAME_SQL_MATCH_BARE}
          AND (name_source IS NULL OR name_source != 'manual');
      `)
    },
  },
  {
    version: 2,
    name: "reset-stale-broken-extras",
    /**
     * Before v0.10.3, syncExtraAchievements stored total_count=0 with
     * achievements_synced_at set as a "known-broken" sentinel whenever
     * GetPlayerAchievements refused the request (for unowned-but-played
     * games — DC Universe Online, Metro 2033, Starbound, etc). v0.10.3
     * added a schema fallback that can populate those games correctly,
     * but the stale filter in syncExtraAchievements skips any row where
     * achievements_synced_at is set AND total_count=0, so the new code
     * path never reached the already-marked-broken rows.
     *
     * This migration clears the sentinel on every such row exactly
     * once, so the next sync re-runs them through the new fallback.
     * Genuinely achievement-less apps (tools, SDKs, servers) will
     * re-settle at total=0 after one extra schema probe; the games
     * that are recoverable via schema will populate their real total.
     */
    run(db) {
      db.exec(`
        UPDATE extra_games
        SET achievements_synced_at = NULL,
            unlocked_count = NULL,
            total_count = NULL,
            perfect_game = 0
        WHERE achievements_synced_at IS NOT NULL
          AND (total_count IS NULL OR total_count = 0);
      `)
    },
  },
  {
    version: 3,
    name: "backfill-release-year-on-synced-platforms",
    /**
     * v0.10.13 added syncGamePlatforms with `filters=platforms`. v0.10.14
     * extends it to also pull `release_date` so the UI can fall back to a
     * release-year (or "Legacy") badge when same-named editions share
     * identical platform support (e.g. GTA III appids 12100 and 12230,
     * both reported as Windows-only by Steam today).
     *
     * Existing rows that synced under v0.10.13 have `platforms` populated
     * but `release_year` NULL — indistinguishable from a legacy stripped
     * listing. This migration nulls `platforms_synced_at` on exactly those
     * rows so the next sync run re-fetches and populates the year.
     * Rows that were negative-cached as delisted (platforms IS NULL) are
     * left alone — they don't need re-fetching.
     */
    run(db) {
      db.exec(`
        UPDATE games
        SET platforms_synced_at = NULL
        WHERE platforms IS NOT NULL AND release_year IS NULL;
      `)
    },
  },
]

function runVersionedMigrations(db: DatabaseSync) {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number }
  const currentVersion = row?.user_version ?? 0

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue
    db.exec("BEGIN")
    try {
      migration.run(db)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
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
  applyAdditiveMigrations(database)
  seedAllowedUsersFromEnv(database)
  seedPinnedGames(database)

  return database
}
