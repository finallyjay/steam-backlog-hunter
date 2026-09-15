import "server-only"

import { env } from "@/lib/env"
import { getSqliteDatabase } from "@/lib/server/sqlite"
import { syncGameAchievements } from "@/lib/server/steam-achievements-sync"
import { nowIso } from "@/lib/server/steam-store-utils"
import { invalidateStatsCache } from "@/lib/steam-stats"
import { getSteamWhitelist } from "@/lib/whitelist"
import { logger } from "@/lib/server/logger"

const SCAN_CONCURRENCY = 4
export const MAX_GAMES_PER_USER_CAP = 5000
// A lease older than this with finished_at still NULL is treated as abandoned
// (process crashed mid-scan) and may be taken over.
export const SCAN_LEASE_STALE_MS = 2 * 60 * 60 * 1000

/** Thrown by `runAchievementScan` when another process holds the scan lease. */
export class ScanInProgressError extends Error {
  constructor() {
    super("An achievement scan is already running")
    this.name = "ScanInProgressError"
  }
}

export type AchievementScanUserResult = {
  steamId: string
  gamesScanned: number
  changesDetected: number
  failures: number
}

export type AchievementScanResult = {
  startedAt: string
  finishedAt: string
  durationMs: number
  usersScanned: number
  gamesScanned: number
  changesDetected: number
  failures: number
  users: AchievementScanUserResult[]
}

export type AchievementScanMeta = {
  startedAt: string
  finishedAt: string | null
  usersScanned: number
  gamesScanned: number
  changesDetected: number
  failures: number
}

type ScanMetaRow = {
  started_at: string
  finished_at: string | null
  users_scanned: number
  games_scanned: number
  changes_detected: number
  failures: number
}

let inFlightScan: Promise<AchievementScanResult> | null = null

function leaseCutoffIso(now = Date.now()): string {
  return new Date(now - SCAN_LEASE_STALE_MS).toISOString()
}

/**
 * True while a scan is running: either started by this process, or recorded
 * in `achievement_scan_meta` by any process sharing the database with
 * `finished_at` still NULL and a start time within the stale-lease window.
 */
export function isAchievementScanRunning(): boolean {
  if (inFlightScan !== null) return true
  const db = getSqliteDatabase()
  const row = db
    .prepare(`SELECT 1 FROM achievement_scan_meta WHERE id = 1 AND finished_at IS NULL AND started_at > ?`)
    .get(leaseCutoffIso())
  return row !== undefined
}

/**
 * Atomically claims the single `achievement_scan_meta` row as "running".
 * Succeeds when no row exists, the previous scan finished, or the previous
 * lease is stale. Returns false when another scan holds a live lease.
 */
function tryAcquireScanLease(startedAt: string): boolean {
  const db = getSqliteDatabase()
  const result = db
    .prepare(
      `
      INSERT INTO achievement_scan_meta (id, started_at, finished_at, users_scanned, games_scanned, changes_detected, failures)
      VALUES (1, ?, NULL, 0, 0, 0, 0)
      ON CONFLICT(id) DO UPDATE SET
        started_at = excluded.started_at,
        finished_at = NULL,
        users_scanned = 0,
        games_scanned = 0,
        changes_detected = 0,
        failures = 0
      WHERE achievement_scan_meta.finished_at IS NOT NULL OR achievement_scan_meta.started_at <= ?
    `,
    )
    .run(startedAt, leaseCutoffIso())
  return Number(result.changes) === 1
}

/** Last recorded scan (from any process sharing the database), or null if none ran yet. */
export function getLastAchievementScan(): AchievementScanMeta | null {
  const db = getSqliteDatabase()
  const row = db.prepare(`SELECT * FROM achievement_scan_meta WHERE id = 1`).get() as ScanMetaRow | undefined
  if (!row) return null
  return {
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    usersScanned: row.users_scanned,
    gamesScanned: row.games_scanned,
    changesDetected: row.changes_detected,
    failures: row.failures,
  }
}

/**
 * Users worth scanning: profiles that completed at least one owned-games
 * sync (so `user_games` is populated) and are still allowed to sign in.
 * Revoked users keep their rows but stop consuming Steam API budget.
 */
export function listScanUsers(): string[] {
  const db = getSqliteDatabase()
  const rows = db
    .prepare(`SELECT steam_id FROM steam_profile WHERE last_owned_games_sync_at IS NOT NULL ORDER BY steam_id`)
    .all() as Array<{ steam_id: string }>

  const allowed = getSteamWhitelist()
  if (env.ADMIN_STEAM_ID) allowed.add(env.ADMIN_STEAM_ID)
  return rows.map((row) => row.steam_id).filter((id) => allowed.has(id))
}

/**
 * Games to visit for a user, most valuable first: perfect games (a
 * regression from 100% is the change the user most wants to hear about),
 * then in-progress, then never started; most recently played breaks ties.
 * Only games known to have achievements (`total_count > 0`) are included.
 */
export function listScanGames(steamId: string, maxGames?: number): number[] {
  const db = getSqliteDatabase()
  const limit = Math.max(1, Math.min(Math.floor(maxGames ?? MAX_GAMES_PER_USER_CAP), MAX_GAMES_PER_USER_CAP))
  const rows = db
    .prepare(
      `
      SELECT appid
      FROM user_games
      WHERE steam_id = ? AND owned = 1 AND total_count > 0
      ORDER BY perfect_game DESC, (COALESCE(unlocked_count, 0) > 0) DESC, COALESCE(rtime_last_played, 0) DESC, appid
      LIMIT ?
    `,
    )
    .all(steamId, limit) as Array<{ appid: number }>
  return rows.map((row) => row.appid)
}

function countChangesSince(steamId: string, sinceIso: string): number {
  const db = getSqliteDatabase()
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM achievement_changes WHERE steam_id = ? AND detected_at >= ?`)
    .get(steamId, sinceIso) as { n: number }
  return row.n
}

function writeScanMeta(meta: AchievementScanMeta) {
  const db = getSqliteDatabase()
  db.prepare(
    `
    INSERT INTO achievement_scan_meta (id, started_at, finished_at, users_scanned, games_scanned, changes_detected, failures)
    VALUES (1, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      users_scanned = excluded.users_scanned,
      games_scanned = excluded.games_scanned,
      changes_detected = excluded.changes_detected,
      failures = excluded.failures
  `,
  ).run(meta.startedAt, meta.finishedAt, meta.usersScanned, meta.gamesScanned, meta.changesDetected, meta.failures)
}

async function scanUser(steamId: string, startedAt: string, maxGames?: number): Promise<AchievementScanUserResult> {
  const appIds = listScanGames(steamId, maxGames)
  let failures = 0
  let cursor = 0

  async function worker() {
    while (cursor < appIds.length) {
      const appId = appIds[cursor++]
      try {
        await syncGameAchievements(steamId, appId)
      } catch (error) {
        failures++
        logger.warn({ err: error, appId }, "Achievement scan: per-game sync failed")
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, appIds.length) }, worker))

  // The scan may have moved counters, so the cached stats snapshot is stale.
  invalidateStatsCache(steamId)

  return {
    steamId,
    gamesScanned: appIds.length,
    changesDetected: countChangesSince(steamId, startedAt),
    failures,
  }
}

function summarize(startedAt: string, startedMs: number, results: AchievementScanUserResult[]): AchievementScanResult {
  return {
    startedAt,
    finishedAt: nowIso(),
    durationMs: Date.now() - startedMs,
    usersScanned: results.length,
    gamesScanned: results.reduce((sum, r) => sum + r.gamesScanned, 0),
    changesDetected: results.reduce((sum, r) => sum + r.changesDetected, 0),
    failures: results.reduce((sum, r) => sum + r.failures, 0),
    users: results,
  }
}

async function doRunAchievementScan(
  startedAt: string,
  options?: { maxGamesPerUser?: number },
): Promise<AchievementScanResult> {
  const startedMs = Date.now()
  const users = listScanUsers()
  logger.info({ users: users.length, maxGamesPerUser: options?.maxGamesPerUser ?? null }, "Achievement scan: start")

  const results: AchievementScanUserResult[] = []
  try {
    for (const steamId of users) {
      results.push(await scanUser(steamId, startedAt, options?.maxGamesPerUser))
    }
  } catch (error) {
    // Release the lease with whatever completed so GET never reports a scan
    // that is neither running nor finished. Per-game errors are handled in
    // scanUser; reaching here means a database/bookkeeping failure.
    const partial = summarize(startedAt, startedMs, results)
    try {
      writeScanMeta({ ...partial, failures: partial.failures + 1 })
    } catch (metaError) {
      logger.error({ err: metaError }, "Achievement scan: could not finalize scan metadata after failure")
    }
    logger.error({ err: error, usersCompleted: results.length }, "Achievement scan: aborted")
    throw error
  }

  const result = summarize(startedAt, startedMs, results)
  writeScanMeta(result)
  logger.info(
    {
      usersScanned: result.usersScanned,
      gamesScanned: result.gamesScanned,
      changesDetected: result.changesDetected,
      failures: result.failures,
      durationMs: result.durationMs,
    },
    "Achievement scan: done",
  )
  return result
}

/**
 * Re-syncs achievements for every scannable user so schema changes are
 * detected (and recorded by `persistSchema`) without anyone opening the app.
 *
 * Only one scan runs at a time: a concurrent call in the same process joins
 * the in-flight run, and a database lease on `achievement_scan_meta` stops
 * a second process sharing the SQLite file from starting a duplicate (it
 * gets `ScanInProgressError`). A lease left open for more than
 * `SCAN_LEASE_STALE_MS` (crashed process) can be taken over. Per-game
 * failures are counted and logged but never abort the scan. Steam budget:
 * one `GetPlayerAchievements` call per game, plus a schema fetch only when
 * the stored schema is stale (30 days) or the player payload reveals a
 * mismatch.
 *
 * @param options.maxGamesPerUser - Cap on games visited per user (highest-priority first)
 * @throws ScanInProgressError when another process holds a live scan lease
 */
export async function runAchievementScan(options?: { maxGamesPerUser?: number }): Promise<AchievementScanResult> {
  if (inFlightScan) return inFlightScan

  const startedAt = nowIso()
  if (!tryAcquireScanLease(startedAt)) {
    throw new ScanInProgressError()
  }
  inFlightScan = doRunAchievementScan(startedAt, options).finally(() => {
    inFlightScan = null
  })
  return inFlightScan
}
