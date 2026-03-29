import "server-only"

import { getSqliteDatabase, reseedTrackedGamesFromFile } from "@/lib/server/sqlite"

/** Returns the set of tracked game app IDs (as strings) for a user from SQLite. */
export async function getTrackedGameIdsServer(steamId: string): Promise<Set<string>> {
  const db = getSqliteDatabase()
  const rows = db.prepare("SELECT appid FROM tracked_games WHERE steam_id = ?").all(steamId) as Array<{ appid: number }>
  return new Set(rows.map((row) => String(row.appid)))
}

/** Re-seeds the tracked games table from the seed file for the given user. */
export async function reseedTrackedGamesServer(steamId: string) {
  const count = reseedTrackedGamesFromFile(steamId)
  return { count }
}
