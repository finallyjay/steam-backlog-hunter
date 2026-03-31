import "server-only"

import { env } from "@/lib/env"
import { getSqliteDatabase } from "@/lib/server/sqlite"

const STEAM_ID_REGEX = /^\d{17}$/

/** Lazily parsed env whitelist — computed once, cached. */
let envWhitelistCache: Set<string> | null = null
function getEnvWhitelist(): Set<string> {
  if (envWhitelistCache) return envWhitelistCache
  const raw = env.STEAM_WHITELIST_IDS
  if (!raw) {
    envWhitelistCache = new Set()
    return envWhitelistCache
  }
  envWhitelistCache = new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => STEAM_ID_REGEX.test(id)),
  )
  return envWhitelistCache
}

/** @internal Reset cached env whitelist — for testing only. */
export function _resetEnvWhitelistCache() {
  envWhitelistCache = null
}

/** Returns all allowed Steam64 IDs from the DB and env var fallback. */
export function getSteamWhitelist(): Set<string> {
  const db = getSqliteDatabase()
  const rows = db.prepare("SELECT steam_id FROM allowed_users").all() as Array<{ steam_id: string }>
  const dbIds = new Set(rows.map((r) => r.steam_id))

  for (const id of getEnvWhitelist()) {
    dbIds.add(id)
  }

  return dbIds
}

/** Checks whether a Steam64 ID is in the allowed users list or is the admin. */
export function isSteamIdWhitelisted(steamId: string): boolean {
  if (env.ADMIN_STEAM_ID && env.ADMIN_STEAM_ID === steamId) {
    return true
  }

  if (!STEAM_ID_REGEX.test(steamId)) return false

  // Direct DB lookup — reuses the same prepared statement via SQLite's cache
  const db = getSqliteDatabase()
  const row = db.prepare("SELECT 1 FROM allowed_users WHERE steam_id = ?").get(steamId)
  if (row) return true

  return getEnvWhitelist().has(steamId)
}
