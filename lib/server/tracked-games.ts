import "server-only"

import { getSqliteDatabase, reseedTrackedGamesFromFile } from "@/lib/server/sqlite"

export async function getTrackedGameIdsServer(steamId: string): Promise<Set<string>> {
  const db = getSqliteDatabase()
  const rows = db.prepare("SELECT appid FROM tracked_games WHERE steam_id = ?").all(steamId) as Array<{ appid: number }>
  return new Set(rows.map((row) => String(row.appid)))
}

export async function reseedTrackedGamesServer(steamId: string) {
  const count = reseedTrackedGamesFromFile(steamId)
  return { count }
}
