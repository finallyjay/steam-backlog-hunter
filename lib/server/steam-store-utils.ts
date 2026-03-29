import "server-only"

import { getSqliteDatabase } from "@/lib/server/sqlite"

export type NullableStringRecord = Record<string, string | null | undefined>

export function nowIso() {
  return new Date().toISOString()
}

export function nullIfUndefined<T>(value: T | undefined): T | null {
  return value === undefined ? null : value
}

function parseIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

export function isStale(value: string | null | undefined, maxAgeMs: number) {
  const timestamp = parseIsoTimestamp(value)
  if (timestamp === null) {
    return true
  }

  return Date.now() - timestamp > maxAgeMs
}

export function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function upsertProfile(steamId: string) {
  const db = getSqliteDatabase()
  const now = nowIso()

  db.prepare(
    `
    INSERT INTO steam_profile (
      steam_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?)
    ON CONFLICT(steam_id) DO UPDATE SET
      updated_at = excluded.updated_at
  `,
  ).run(steamId, now, now)
}

export function markProfileSync(
  steamId: string,
  column: "last_owned_games_sync_at" | "last_recent_games_sync_at",
  value: string,
) {
  const db = getSqliteDatabase()
  db.prepare(
    `
    UPDATE steam_profile
    SET ${column} = ?, updated_at = ?
    WHERE steam_id = ?
  `,
  ).run(value, value, steamId)
}

export function getProfileSync(steamId: string) {
  const db = getSqliteDatabase()
  return db
    .prepare(
      `
    SELECT last_owned_games_sync_at, last_recent_games_sync_at
    FROM steam_profile
    WHERE steam_id = ?
  `,
    )
    .get(steamId) as NullableStringRecord | undefined
}

export function roundPercent(value: number) {
  return Math.floor(value)
}
