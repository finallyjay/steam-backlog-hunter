import "server-only"

import { getSqliteDatabase } from "@/lib/server/sqlite"
import { nowIso } from "@/lib/server/steam-store-utils"
import { logger } from "@/lib/server/logger"

const STEAM_API_BASE = "https://api.steampowered.com"
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000
const MAX_PAGES = 50
const DB_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

let cached: { map: Map<number, string>; fetchedAt: number } | null = null
let failedUntil = 0
let inflight: Promise<Map<number, string> | null> | null = null

type GetAppListResponse = {
  response?: {
    apps?: Array<{ appid: number; name: string }>
    have_more_results?: boolean
    last_appid?: number
  }
}

/**
 * Returns a Map<appid, name> for every app currently published on Steam —
 * including Tools, Software and SDK entries that `store.steampowered.com/api/appdetails`
 * reports as `success=false` and that have no achievement schema or community
 * page (e.g. appid 745, "Dota 2 Workshop Tools"). This is the only endpoint
 * that enumerates those apps with their public names.
 *
 * The catalog is large (200k+ entries across ~5 paginated calls) and is
 * cached in-memory for 24h. Concurrent callers share an in-flight promise
 * so we never fetch twice in parallel. Failures apply a 5-minute cooldown
 * so a broken endpoint can't be hammered repeatedly.
 *
 * Returns null when the catalog is unavailable so callers can fall through
 * gracefully.
 */
export async function getSteamAppCatalog(): Promise<Map<number, string> | null> {
  const now = Date.now()
  if (cached && now - cached.fetchedAt < CATALOG_TTL_MS) {
    return cached.map
  }
  if (now < failedUntil) {
    return null
  }
  if (inflight) {
    return inflight
  }

  inflight = fetchCatalogFromSteam()
    .then((map) => {
      if (map && map.size > 0) {
        cached = { map, fetchedAt: Date.now() }
      } else {
        failedUntil = Date.now() + FAILURE_COOLDOWN_MS
      }
      return map
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

async function fetchCatalogFromSteam(): Promise<Map<number, string> | null> {
  const apiKey = process.env.STEAM_API_KEY
  if (!apiKey) return null

  const map = new Map<number, string>()
  let lastAppid = 0
  let pages = 0

  try {
    while (pages < MAX_PAGES) {
      pages++
      const url = new URL(`${STEAM_API_BASE}/IStoreService/GetAppList/v1/`)
      url.searchParams.set("key", apiKey)
      url.searchParams.set("format", "json")
      url.searchParams.set("include_games", "1")
      url.searchParams.set("include_dlc", "1")
      url.searchParams.set("include_software", "1")
      url.searchParams.set("include_hardware", "1")
      url.searchParams.set("include_videos", "0")
      url.searchParams.set("max_results", "50000")
      if (lastAppid > 0) url.searchParams.set("last_appid", String(lastAppid))

      const response = await fetch(url.toString(), { cache: "no-store" })
      if (!response.ok) {
        logger.warn(
          { status: response.status, pages, entriesSoFar: map.size },
          "IStoreService/GetAppList returned non-OK — aborting catalog fetch",
        )
        return null
      }

      const data = (await response.json()) as GetAppListResponse
      const apps = data.response?.apps ?? []
      for (const app of apps) {
        if (app.name) map.set(app.appid, app.name)
      }

      if (!data.response?.have_more_results || !data.response?.last_appid) break
      if (data.response.last_appid === lastAppid) break
      lastAppid = data.response.last_appid
    }

    logger.info({ entries: map.size, pages }, "Fetched Steam app catalog")
    return map
  } catch (error) {
    logger.warn({ err: error }, "Failed to fetch Steam app catalog")
    return null
  }
}

/**
 * Bulk-seeds the shared `games` table from Steam's canonical app catalog.
 *
 * The Steam Web API has no single-app endpoint that reliably names Tools,
 * Software and SDK entries (`store.steampowered.com/api/appdetails` returns
 * `success=false` for them, `GetSchemaForGame` requires achievements, and
 * `steamcommunity.com/app/<id>` redirects to the homepage). The only source
 * that enumerates these apps is `IStoreService/GetAppList/v1/`, which
 * returns the entire Steam catalog — 200k+ entries spread across ~5
 * paginated calls.
 *
 * Runs at most once every 7 days across the whole deployment, tracked via
 * the single-row `app_catalog_meta` table. The first user whose sync hits
 * this path pays the ~5s fetch cost; every subsequent caller in the next
 * week is an O(1) no-op via the `populated_at` check.
 *
 * Uses `INSERT OR IGNORE` so rows already populated by per-user syncs
 * (with their Spanish-localized `name` and image URLs) stay intact.
 * Newly-inserted rows land with English catalog names and NULL images;
 * when a user subsequently owns one of those apps, the normal library
 * sync upserts the localized name and images on top.
 *
 * Swallows all errors and returns 0 when the fetch fails or is throttled.
 * The per-appid resolution chain in `hydrateMissingExtraNames` remains
 * the safety net for apps the catalog genuinely doesn't cover.
 *
 * Returns the number of rows newly inserted into `games`.
 */
export async function populateGamesFromSteamCatalog(): Promise<number> {
  const db = getSqliteDatabase()

  const meta = db.prepare(`SELECT populated_at FROM app_catalog_meta WHERE id = 1`).get() as
    | { populated_at: string }
    | undefined

  if (meta?.populated_at) {
    const ageMs = Date.now() - Date.parse(meta.populated_at)
    if (ageMs < DB_REFRESH_INTERVAL_MS) {
      return 0
    }
  }

  const catalog = await getSteamAppCatalog()
  if (!catalog || catalog.size === 0) return 0

  const now = nowIso()
  const insert = db.prepare(`INSERT OR IGNORE INTO games (appid, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)

  let inserted = 0
  db.exec("BEGIN")
  try {
    for (const [appid, name] of catalog) {
      const result = insert.run(appid, name, now, now)
      if (result.changes > 0) inserted++
    }
    db.prepare(
      `INSERT INTO app_catalog_meta (id, populated_at, entry_count)
       VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET populated_at = excluded.populated_at, entry_count = excluded.entry_count`,
    ).run(now, catalog.size)
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    logger.warn({ err: error }, "populateGamesFromSteamCatalog failed")
    return 0
  }

  logger.info({ inserted, catalogSize: catalog.size }, "Seeded games table from Steam app catalog")
  return inserted
}

/** Test-only: reset in-memory state between test cases. */
export function __resetSteamAppCatalogForTests() {
  cached = null
  failedUntil = 0
  inflight = null
}
