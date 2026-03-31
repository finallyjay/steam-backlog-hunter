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

interface UpsertProfileOptions {
  personaName?: string
  avatarUrl?: string
  profileUrl?: string
  lastLoginAt?: string
}

export function upsertProfile(steamId: string, options?: UpsertProfileOptions) {
  const db = getSqliteDatabase()
  const now = nowIso()

  db.prepare(
    `
    INSERT INTO steam_profile (
      steam_id,
      persona_name,
      avatar_url,
      profile_url,
      last_login_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(steam_id) DO UPDATE SET
      persona_name = COALESCE(excluded.persona_name, steam_profile.persona_name),
      avatar_url = COALESCE(excluded.avatar_url, steam_profile.avatar_url),
      profile_url = COALESCE(excluded.profile_url, steam_profile.profile_url),
      last_login_at = COALESCE(excluded.last_login_at, steam_profile.last_login_at),
      updated_at = excluded.updated_at
  `,
  ).run(
    steamId,
    options?.personaName ?? null,
    options?.avatarUrl ?? null,
    options?.profileUrl ?? null,
    options?.lastLoginAt ?? null,
    now,
    now,
  )
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
