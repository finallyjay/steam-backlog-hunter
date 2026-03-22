import "server-only"

import { getSqliteDatabase, reseedTrackedGamesFromFile } from "@/lib/server/sqlite"

export async function getTrackedGameIdsServer(): Promise<Set<string>> {
  const db = getSqliteDatabase()
  const rows = db.prepare("SELECT appid FROM tracked_games").all() as Array<{ appid: number }>
  return new Set(rows.map((row) => String(row.appid)))
}

export async function reseedTrackedGamesServer() {
  const count = reseedTrackedGamesFromFile()
  return { count }
}
