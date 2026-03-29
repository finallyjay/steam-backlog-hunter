import { env } from "@/lib/env"
import { getSqliteDatabase } from "@/lib/server/sqlite"

const STEAM_ID_REGEX = /^\d{17}$/

/** Returns all allowed Steam64 IDs from the DB and env var fallback. */
export function getSteamWhitelist(): Set<string> {
  // Check DB first
  const db = getSqliteDatabase()
  const rows = db.prepare("SELECT steam_id FROM allowed_users").all() as Array<{ steam_id: string }>
  const dbIds = new Set(rows.map((r) => r.steam_id))

  // Fall back to env var
  const rawWhitelist = env.STEAM_WHITELIST_IDS
  if (rawWhitelist) {
    const envIds = rawWhitelist
      .split(",")
      .map((id) => id.trim())
      .filter((id) => STEAM_ID_REGEX.test(id))
    for (const id of envIds) {
      dbIds.add(id)
    }
  }

  return dbIds
}

/** Checks whether a Steam64 ID is in the allowed users list or is the admin. */
export function isSteamIdWhitelisted(steamId: string): boolean {
  // Admin always has access
  if (env.ADMIN_STEAM_ID && env.ADMIN_STEAM_ID === steamId) {
    return true
  }
  const whitelist = getSteamWhitelist()
  return whitelist.has(steamId)
}
